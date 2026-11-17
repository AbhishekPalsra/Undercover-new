"""The UnderCover Agent, using only backend API tools."""

import json
import os
from typing import Literal

import httpx
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from agent.activity import ModelActivity
from agent.testing import scripted_model

load_dotenv()
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-6-luna"
MAX_RESPONSE_TOKENS = 8192


def backend() -> httpx.Client:
    """Return an API client for the local backend."""
    return httpx.Client(
        base_url=os.getenv("BACKEND_URL", "http://localhost:8000"), timeout=30
    )


def model() -> ChatOpenAI:
    """Construct the configured OpenRouter model."""
    name = os.getenv("MODEL_NAME")
    return ChatOpenAI(
        model=name or DEFAULT_MODEL,
        base_url=OPENROUTER_BASE_URL,
        api_key=SecretStr(os.environ["OPENROUTER_API_KEY"]),
        reasoning_effort=None if name else "low",
        max_completion_tokens=MAX_RESPONSE_TOKENS,
    )


def run(claim_id: str, thread_id: str) -> str:
    """Decide one claim using API context and record the result."""
    with backend() as client:
        path = f"/api/claims/{claim_id}"

        def get(url: str):
            response = client.get(url)
            response.raise_for_status()
            return response.json()

        def post(url: str, body: dict) -> str:
            response = client.post(url, json=body)
            response.raise_for_status()
            return response.text

        def report(action: str, message: str) -> None:
            post(
                path + "/progress",
                {"thread_id": thread_id, "action": action, "message": message},
            )

        instructions = get("/api/instructions")

        @tool
        def read_context() -> str:
            """Read this claim, linked policy, plan, history and full policy wording."""
            context = {"claim": get(path), "wording": get("/api/policy-wording")}
            report("context", "Read claim, policy, plan, history and policy wording")
            return json.dumps(context)

        @tool
        def record_decision(
            outcome: Literal["approve", "decline", "refer"],
            amount: str,
            calculation: str,
            reason: str,
            policy_section: str,
        ) -> str:
            """Record outcome, dollar amount, calculation, reason and policy section."""
            return post(
                path + "/decision",
                {
                    "thread_id": thread_id,
                    "outcome": outcome,
                    "amount": amount,
                    "calculation": calculation,
                    "reason": reason,
                    "policy_section": policy_section,
                },
            )

        @tool
        def pay_claim(amount: str) -> str:
            """Request simulated payment of the exact approved dollar amount."""
            response = client.post(path + "/pay", json={"amount": amount})
            report(
                "payment_result",
                "Payment recorded"
                if response.is_success
                else "Payment blocked: " + str(response.json()["detail"]),
            )
            return response.text

        configured = os.getenv("MODEL_NAME") or DEFAULT_MODEL
        if os.getenv("UNDERCOVER_STUB") == "1":
            llm = scripted_model(claim_id)
            configured = "test/scripted-claims"
        else:
            llm = model()
        report("model_requested", configured)
        agent = create_agent(
            llm,
            tools=[read_context, record_decision, pay_claim],
            system_prompt=instructions["text"],
        )
        result = agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": f"Process claim {claim_id}. Read context first.",
                    }
                ]
            },
            config={
                "configurable": {"thread_id": thread_id},
                "recursion_limit": 30,
                "callbacks": [ModelActivity(report)],
            },
        )
        return result["messages"][-1].text

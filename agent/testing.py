"""Scripted tool-calling model for explicitly selected local test mode."""

import os
from threading import Event

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

GATES: dict[str, Event] = {}
FAILURES: set[str] = set()


class StubModel(GenericFakeChatModel):
    """Bind scripted calls without a model provider."""

    def bind_tools(self, tools, **kwargs):
        return self


def scripted_model(claim_id: str) -> StubModel:
    """Return synthetic decisions for workflow tests, never accuracy evaluation."""
    suffix = claim_id[-1]
    outcome = {"3": "decline", "4": "refer"}.get(suffix, "approve")
    amount = "1250.00" if suffix == "2" else "420.00"
    if outcome != "approve":
        amount = "0.00"
    calls = [
        ("read_context", {}),
        (
            "record_decision",
            {
                "outcome": outcome,
                "amount": amount,
                "calculation": "Synthetic workflow test amount.",
                "reason": "Scripted decision. This tests workflow only.",
                "policy_section": "3. Trip Delay",
            },
        ),
    ]
    if outcome == "approve":
        calls.append(("pay_claim", {"amount": amount}))
    replies = [
        AIMessage(
            content="",
            response_metadata={"model_name": "test/scripted-claims"},
            tool_calls=[{"name": name, "args": args, "id": str(index)}],
        )
        for index, (name, args) in enumerate(calls)
    ]
    replies.append(
        AIMessage(
            content="Recorded the test decision.",
            response_metadata={"model_name": "test/scripted-claims"},
        )
    )

    gate = Event()
    GATES[claim_id] = gate

    def responses():
        yield replies[0]
        if os.getenv("UNDERCOVER_STUB_GATE") == "1":
            if not gate.wait(20):
                raise RuntimeError("Test gate timed out")
            if claim_id in FAILURES:
                raise RuntimeError("Synthetic provider failure")
        yield replies[1]
        if suffix == "6":
            raise RuntimeError("Synthetic interruption after decision")
        yield from replies[2:]

    return StubModel(messages=responses())

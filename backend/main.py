"""The UnderCover claims API."""

from contextlib import asynccontextmanager
from threading import Thread
from typing import Any

from fastapi import FastAPI

from agent.main import run
from backend import store, workflow


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.initialize()
    workflow.recover()
    yield


app = FastAPI(title="UnderCover", lifespan=lifespan)


@app.get("/api/health", operation_id="health")
def health() -> dict[str, str]:
    """Check that the backend is running."""
    return {"status": "ok"}


@app.get("/api/claims", operation_id="list_claims")
def claims() -> list[dict[str, Any]]:
    """Read the claims queue."""
    with store.transaction() as db:
        ids = db.execute("SELECT id FROM claims ORDER BY id").fetchall()
        return [store.detail(db, row[0]) for row in ids]


@app.get("/api/claims/{claim_id}", operation_id="get_claim")
def claim(claim_id: str) -> dict[str, Any]:
    """Read the full claim and linked records."""
    with store.transaction() as db:
        return store.detail(db, claim_id)


@app.get("/api/policy-wording", operation_id="policy_wording")
def wording() -> dict[str, str]:
    """Read the full policy wording."""
    with store.transaction() as db:
        return store.resource(db, "wording")


@app.get("/api/instructions", operation_id="instructions")
def instructions() -> dict[str, Any]:
    """Read the agent instructions and pilot settings."""
    with store.transaction() as db:
        company = store.resource(db, "company")
        threshold = company["payout_approval_limit"]
        text = store.INSTRUCTIONS + (
            f"\nCurrency: USD. Handler sign-off is required above ${threshold:,.2f}."
        )
        return {"text": text, "company": company}


@app.get("/api/handlers", operation_id="handlers")
def handlers() -> list[dict[str, Any]]:
    """Read handlers available for sign-off."""
    with store.transaction() as db:
        return store.resource(db, "handlers")


@app.post("/api/claims/run", operation_id="start_all_claims", status_code=202)
def start_all_claims() -> dict[str, int]:
    """Queue every waiting claim for sequential agent processing."""
    runs = workflow.start_all()
    if runs:
        launch_all(runs)
    return {"queued": len(runs)}


@app.post("/api/claims/reset", operation_id="reset_all_claims")
def reset_all_claims() -> dict[str, int]:
    """Reset all claims to waiting while preserving their evidence."""
    return {"reset": workflow.reset_all()}


@app.post("/api/claims/{claim_id}/run", operation_id="start_run", status_code=202)
def start_run(claim_id: str) -> dict[str, str]:
    """Reserve a claim for agent processing."""
    thread_id = workflow.start(claim_id)
    launch(claim_id, thread_id)
    return {"thread_id": thread_id}


@app.get("/api/claims/{claim_id}/progress", operation_id="get_progress")
def progress(claim_id: str) -> list[dict[str, Any]]:
    """Read ordered progress events."""
    with store.transaction() as db:
        return store.claim_record(db, claim_id)["progress"]


@app.post("/api/claims/{claim_id}/progress", operation_id="append_progress")
def append_progress(claim_id: str, body: workflow.Event) -> dict[str, str]:
    """Append an event from the current run."""
    with store.transaction() as db:
        record = store.claim_record(db, claim_id)
        workflow.require(
            record["active"] and record["thread_id"] == body.thread_id,
            "Run is no longer active",
        )
        workflow.event(record, body.action, body.message)
        store.save(db, record)
    return {"status": "recorded"}


@app.post("/api/claims/{claim_id}/decision", operation_id="record_decision")
def decision(claim_id: str, body: workflow.Decision) -> dict[str, str]:
    """Record the current run's decision."""
    workflow.record_decision(claim_id, body)
    return {"status": "recorded"}


@app.post("/api/claims/{claim_id}/pay", operation_id="pay_claim")
def pay(claim_id: str, body: workflow.Payment) -> dict[str, str]:
    """Pay the exact approved amount subject to sign-off."""
    workflow.pay(claim_id, body.amount)
    return {"status": "paid"}


@app.post("/api/claims/{claim_id}/sign-off", operation_id="sign_off_claim")
def sign_off(claim_id: str, body: workflow.SignOff) -> dict[str, str]:
    """Record handler sign-off and release simulated payment."""
    workflow.sign_off(claim_id, body.handler_id)
    return {"status": "paid"}


def execute(claim_id: str, thread_id: str) -> None:
    """Run the agent and leave errors visible to handlers."""

    error = ""
    try:
        run(claim_id, thread_id)
    except Exception as exc:
        error = str(exc)
    workflow.finish(claim_id, thread_id, error)


def launch(claim_id: str, thread_id: str) -> None:
    """Launch local work without blocking the response."""
    Thread(target=execute, args=(claim_id, thread_id), daemon=True).start()


def execute_all(runs: list[tuple[str, str]]) -> None:
    """Process each reserved claim once, preserving per-claim error handling."""
    for claim_id, thread_id in runs:
        with store.transaction() as db:
            record = store.claim_record(db, claim_id)
            workflow.event(record, "started", "Agent started")
            store.save(db, record)
        execute(claim_id, thread_id)


def launch_all(runs: list[tuple[str, str]]) -> None:
    """Keep processing the reserved queue when the browser closes."""
    Thread(target=execute_all, args=(runs,), daemon=True).start()

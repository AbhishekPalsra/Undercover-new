"""Test-only controls, served only by the disposable test launcher."""

from pydantic import BaseModel

from agent.testing import FAILURES, GATES
from backend.main import app


class Release(BaseModel):
    fail: bool


@app.post("/test/claims/{claim_id}/release", operation_id="release_test_run")
def release(claim_id: str, body: Release) -> dict[str, str]:
    """Release a scripted test model after its context read."""
    if body.fail:
        FAILURES.add(claim_id)
    else:
        FAILURES.discard(claim_id)
    GATES[claim_id].set()
    return {"status": "released"}

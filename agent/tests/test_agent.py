import json
from contextlib import nullcontext
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient

from agent import main
from agent.activity import ModelActivity
from backend import main as api
from backend import workflow


@pytest.mark.parametrize(
    ("claim_id", "outcome"),
    [
        ("CLM-1001", "approve"),
        ("CLM-1002", "approve"),
        ("CLM-1003", "decline"),
        ("CLM-1004", "refer"),
    ],
)
def test_run(tmp_path, monkeypatch, claim_id, outcome):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "claims.db"))
    monkeypatch.setenv("UNDERCOVER_STUB", "1")
    monkeypatch.setattr(api, "launch", lambda *_: None)
    with TestClient(api.app) as client:
        monkeypatch.setattr(api, "run", main.run)
        monkeypatch.setattr(main, "backend", lambda: nullcontext(client))
        path = "/api/claims/" + claim_id
        thread = client.post(path + "/run").json()["thread_id"]
        api.execute(claim_id, thread)
        record = client.get(path).json()
        assert record["decision"]["outcome"] == outcome
        assert record["active"] is False
        if claim_id == "CLM-1002":
            assert record["status"] == "waiting_for_sign_off"
            assert record["payment"] is None
        elif outcome == "approve":
            assert record["payment"]["amount"] == "420.00"
        assert any(e["action"] == "context" for e in record["progress"])
        models = [e["message"] for e in record["progress"] if e["action"] == "model"]
        assert models == ["test/scripted-claims"]


def test_model_name(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.delenv("MODEL_NAME", raising=False)
    assert main.model().model_name == "openai/gpt-6-luna"
    assert main.model().reasoning_effort == "low"
    monkeypatch.setenv("MODEL_NAME", "openrouter/free")
    assert main.model().model_name == "openrouter/free"
    assert main.model().reasoning_effort is None


@pytest.mark.parametrize("name", ["", "openrouter/free"])
def test_model_request_has_explicit_response_limit(monkeypatch, name):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("MODEL_NAME", name)
    requests = []
    reported = []
    served = "provider/routed:free" if name else main.DEFAULT_MODEL

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "test-completion",
                "object": "chat.completion",
                "created": 0,
                "model": served,
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "Ready"},
                    }
                ],
            },
        )

    constructor = main.ChatOpenAI
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(
            main,
            "ChatOpenAI",
            lambda **kwargs: constructor(
                **kwargs,
                http_client=client,
            ),
        )
        callback = ModelActivity(
            lambda action, message: reported.append((action, message))
        )
        assert (
            main.model()
            .invoke("Check configuration", config={"callbacks": [callback]})
            .text
            == "Ready"
        )
    assert requests[0]["model"] == (name or main.DEFAULT_MODEL)
    assert requests[0]["max_completion_tokens"] == 8192
    assert reported == [("model", served)]


def test_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "claims.db"))
    monkeypatch.setenv("UNDERCOVER_STUB", "0")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setattr(api, "launch", lambda *_: None)
    with TestClient(api.app) as client:
        monkeypatch.setattr(api, "run", main.run)
        monkeypatch.setattr(main, "backend", lambda: nullcontext(client))
        thread = client.post("/api/claims/CLM-1001/run").json()["thread_id"]
        api.execute("CLM-1001", thread)
        assert client.get("/api/claims/CLM-1001").json()["status"] == "waiting"
        assert (
            client.get("/api/claims/CLM-1001/progress").json()[-1]["action"] == "error"
        )
        thread = client.post("/api/claims/CLM-1001/run").json()["thread_id"]
        workflow.finish("CLM-1001", thread, "")


def test_background_progress(tmp_path, monkeypatch):

    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "claims.db"))
    entered, release, finished = Event(), Event(), Event()

    def paused_run(claim_id, thread_id):
        entered.set()
        release.wait(5)

    original_finish = workflow.finish

    def finish_run(claim_id, thread_id, error):
        original_finish(claim_id, thread_id, error)
        finished.set()

    monkeypatch.setattr(workflow, "finish", finish_run)
    monkeypatch.setattr(api, "run", paused_run)
    with TestClient(api.app) as client:
        try:
            response = client.post("/api/claims/CLM-1001/run")
            assert response.status_code == 202
            assert entered.wait(5)
            assert client.get("/api/claims/CLM-1001").json()["active"]
            assert client.get("/api/claims/CLM-1001/progress").json()
        finally:
            release.set()
            assert finished.wait(5)

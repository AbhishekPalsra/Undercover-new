from contextlib import nullcontext

import httpx
import pytest
from fastapi.testclient import TestClient

from agent import cli
from backend import main as api
from backend import workflow


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "claims.db"))
    monkeypatch.setattr(api, "launch", lambda *_: None)
    monkeypatch.setattr(api, "launch_all", lambda *_: None)
    with TestClient(api.app) as server:

        def transport(request):
            response = server.request(
                request.method,
                str(request.url),
                content=request.content,
                headers=dict(request.headers),
            )
            return httpx.Response(
                response.status_code,
                content=response.content,
                headers=dict(response.headers),
                request=request,
            )

        with httpx.Client(
            base_url="http://testserver", transport=httpx.MockTransport(transport)
        ) as client:
            monkeypatch.setattr(cli, "backend", lambda: nullcontext(client))
            yield client


def test_start_single_and_all_use_the_backend(client, capsys):
    assert cli.main(["run", "CLM-1001"]) == 0
    assert client.get("/api/claims/CLM-1001").json()["active"]
    assert cli.main(["run", "--all"]) == 0
    output = capsys.readouterr().out
    assert "Started CLM-1001" in output
    assert "Queued 24 waiting claims" in output
    assert all(c["active"] for c in client.get("/api/claims").json())


def test_reset_confirmation_cancel_and_yes(client, monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda _: "no")
    assert cli.main(["reset"]) == 0
    assert "Reset canceled" in capsys.readouterr().out
    thread = client.post("/api/claims/CLM-1001/run").json()["thread_id"]
    workflow.finish("CLM-1001", thread, "Failed review")
    monkeypatch.setattr("builtins.input", lambda _: "yes")
    assert cli.main(["reset"]) == 0
    assert client.get("/api/claims/CLM-1001").json()["progress"] == []
    assert cli.main(["reset", "--yes"]) == 0
    assert "Reset 25 claims to waiting" in capsys.readouterr().out


def test_reset_rejects_active_work(client, capsys):
    client.post("/api/claims/CLM-1001/run")
    assert cli.main(["reset", "--yes"]) == 1
    assert "Wait for all agent runs to finish" in capsys.readouterr().err
    assert client.get("/api/claims/CLM-1001").json()["active"]


def test_wait_prints_saved_decision_and_model(client, monkeypatch, capsys):
    def complete(_seconds):
        claim = client.get("/api/claims/CLM-1001").json()
        thread = claim["thread_id"]
        client.post(
            "/api/claims/CLM-1001/progress",
            json={
                "thread_id": thread,
                "action": "model",
                "message": "test/example",
            },
        )
        client.post(
            "/api/claims/CLM-1001/decision",
            json={
                "thread_id": thread,
                "outcome": "approve",
                "amount": "420",
                "calculation": "245 + 95 + 80",
                "reason": "Covered loss. Evidence confirms it.",
                "policy_section": "3",
            },
        )
        client.post("/api/claims/CLM-1001/pay", json={"amount": "420"})
        workflow.finish("CLM-1001", thread, "")

    monkeypatch.setattr(cli.time, "sleep", complete)
    assert cli.main(["run", "CLM-1001", "--wait"]) == 0
    output = capsys.readouterr().out
    assert "Outcome: approve" in output
    assert "Simulated payment: $420.00" in output
    assert "Responding models: test/example" in output


def test_wait_all_reports_failed_claims(client, monkeypatch, capsys):
    def fail(_claim, _thread):
        raise RuntimeError("Synthetic failure")

    monkeypatch.setattr(api, "run", fail)
    monkeypatch.setattr(api, "launch_all", api.execute_all)
    assert cli.main(["run", "--all", "--wait"]) == 1
    assert "No decision saved. Synthetic failure" in capsys.readouterr().out


def test_pending_payment_and_saved_decision_error(client, capsys):
    thread = client.post("/api/claims/CLM-1001/run").json()["thread_id"]
    client.post(
        "/api/claims/CLM-1001/decision",
        json={
            "thread_id": thread,
            "outcome": "approve",
            "amount": "1250",
            "calculation": "Eligible costs",
            "reason": "Covered loss. Evidence confirms it.",
            "policy_section": "3",
        },
    )
    workflow.finish("CLM-1001", thread, "Provider interrupted")
    assert cli.wait_for_results(client, "CLM-1001") == 1
    output = capsys.readouterr().out
    assert "Payment pending" in output
    assert "Review error: Provider interrupted" in output


@pytest.mark.parametrize("args", [["run"], ["run", "CLM-1001", "--all"]])
def test_invalid_selection(args):
    with pytest.raises(SystemExit, match="2"):
        cli.main(args)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404, json={"detail": "Claim not found"}),
        httpx.Response(503, text="Backend unavailable"),
    ],
)
def test_rejected_request(monkeypatch, capsys, response):
    with httpx.Client(
        base_url="http://backend.test",
        transport=httpx.MockTransport(lambda _: response),
    ) as client:
        monkeypatch.setattr(cli, "backend", lambda: nullcontext(client))
        assert cli.main(["run", "CLM-1001"]) == 1
    assert "Backend rejected the request" in capsys.readouterr().err


def test_connection_error(monkeypatch, capsys):
    def offline(request):
        raise httpx.ConnectError("Offline", request=request)

    with httpx.Client(
        base_url="http://backend.test", transport=httpx.MockTransport(offline)
    ) as client:
        monkeypatch.setattr(cli, "backend", lambda: nullcontext(client))
        assert cli.main(["run", "CLM-1001"]) == 1
    assert "Cannot reach the backend" in capsys.readouterr().err


@pytest.mark.parametrize("error", [KeyboardInterrupt, EOFError])
def test_interrupted_confirmation(client, monkeypatch, capsys, error):
    def interrupt(_prompt):
        raise error

    monkeypatch.setattr("builtins.input", interrupt)
    assert cli.main(["reset"]) == 130
    assert "Command interrupted" in capsys.readouterr().err

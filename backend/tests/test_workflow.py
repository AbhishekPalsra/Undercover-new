from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend import main, workflow
from backend.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "claims.db"))
    monkeypatch.setattr(main, "launch", lambda *_: None)
    with TestClient(app) as client:
        yield client


def decide(client, amount="1000", outcome="approve"):
    path = "/api/claims/CLM-1001"
    thread = client.post(path + "/run").json()["thread_id"]
    body = dict(
        thread_id=thread,
        outcome=outcome,
        amount=amount,
        calculation="Eligible expenses subject to limit.",
        reason="Covered loss. Documents confirm it.",
        policy_section="3",
    )
    assert client.post(path + "/decision", json=body).status_code == 200
    return path, body


@pytest.mark.parametrize("amount", ["1000", "1000.01", "0.10", "0.20"])
def test_payment_gate(client, amount):
    path, body = decide(client, amount)
    assert client.post(path + "/decision", json=body).status_code == 409
    assert client.post(path + "/pay", json={"amount": "999"}).status_code == 409
    if amount == "1000.01":
        assert client.post(path + "/pay", json={"amount": amount}).status_code == 409
        assert client.get(path).json()["payment"] is None
        assert (
            client.post(path + "/sign-off", json={"handler_id": "bad"}).status_code
            == 409
        )
        assert (
            client.post(path + "/sign-off", json={"handler_id": "HND-01"}).status_code
            == 200
        )
        assert (
            client.post(path + "/sign-off", json={"handler_id": "HND-01"}).status_code
            == 409
        )
    else:
        with ThreadPoolExecutor() as pool:
            statuses = list(
                pool.map(
                    lambda _: (
                        client.post(path + "/pay", json={"amount": amount}).status_code
                    ),
                    range(2),
                )
            )
        assert sorted(statuses) == [200, 409]
    record = client.get(path).json()
    assert record["payment"]["amount"] == amount
    assert record["status"] == "decided"


@pytest.mark.parametrize("outcome", ["decline", "refer"])
def test_nonpayment(client, outcome):
    path, _ = decide(client, "0", outcome)
    assert client.post(path + "/pay", json={"amount": "0"}).status_code == 409
    assert client.get(path).json()["decision"]["outcome"] == outcome


def test_run_errors(client):
    path = "/api/claims/CLM-1001"
    assert client.post(path + "/pay", json={"amount": "0"}).status_code == 409
    assert client.post(path + "/pay", json={"amount": "-1"}).status_code == 422
    thread = client.post(path + "/run").json()["thread_id"]
    assert client.post(path + "/run").status_code == 409
    for tid, code in [(thread, 200), ("stale", 409)]:
        assert (
            client.post(
                path + "/progress",
                json=dict(thread_id=tid, action="read", message="Reading"),
            ).status_code
            == code
        )
    assert len(client.get(path + "/progress").json()) == 2
    workflow.finish("CLM-1001", "stale", "")
    workflow.recover()
    assert client.get(path).json()["status"] == "waiting"
    assert client.post("/api/claims/missing/run").status_code == 404


def test_restart_preserves_decision_and_payment(client):
    path, body = decide(client)
    workflow.recover()
    record = client.get(path).json()
    assert record["status"] == "decided"
    assert record["decision"]["reason"] == body["reason"]
    assert record["active"] is False
    assert client.post(path + "/pay", json={"amount": "1000"}).status_code == 200
    workflow.recover()
    assert client.get(path).json()["payment"]["amount_cents"] == 100000
    assert client.post(path + "/run").status_code == 409


def test_required_inputs_and_validation(client):
    schema = client.get("/openapi.json").json()
    for name in ("Payment", "Decision", "Event", "SignOff"):
        model = schema["components"]["schemas"][name]
        assert set(model["required"]) == set(model["properties"])
    path = "/api/claims/CLM-1001"
    assert client.post(path + "/pay", json={"amount": "1.001"}).status_code == 422
    assert client.post(path + "/sign-off", json={}).status_code == 422
    thread = client.post(path + "/run").json()["thread_id"]
    body = dict(
        thread_id=thread,
        outcome="decline",
        amount="1",
        calculation="None",
        reason="Not covered. Excluded by wording.",
        policy_section="9",
    )
    assert client.post(path + "/decision", json=body).status_code == 409


def test_start_all_skips_existing_work_and_duplicate_requests(client, monkeypatch):
    path, _ = decide(client, "1000.01")
    client.post("/api/claims/CLM-1002/run")
    launched = []
    monkeypatch.setattr(main, "launch_all", launched.append)
    response = client.post("/api/claims/run")
    assert response.status_code == 202
    assert response.json() == {"queued": 23}
    assert len(launched) == 1
    assert len(launched[0]) == 23
    assert client.post("/api/claims/run").json() == {"queued": 0}
    assert len(launched) == 1
    assert client.get(path).json()["status"] == "waiting_for_sign_off"
    assert client.post(path + "/pay", json={"amount": "1000.01"}).status_code == 409
    assert client.get("/api/claims/CLM-1003/progress").json()[0]["action"] == "queued"


def test_start_all_concurrent_requests_reserve_once(client, monkeypatch):
    monkeypatch.setattr(main, "launch_all", lambda _: None)
    with ThreadPoolExecutor() as pool:
        counts = list(
            pool.map(
                lambda _: client.post("/api/claims/run").json()["queued"], range(2)
            )
        )
    assert sorted(counts) == [0, 25]


def test_batch_continues_after_failure(client, monkeypatch):
    visited = []

    def fake_run(claim_id, _thread_id):
        visited.append(claim_id)
        raise RuntimeError("Provider unavailable")

    monkeypatch.setattr(main, "run", fake_run)
    runs = workflow.start_all()
    main.execute_all(runs)
    assert visited == [claim_id for claim_id, _ in runs]
    assert len(visited) == 25
    queue = client.get("/api/claims").json()
    assert all(c["status"] == "waiting" and not c["active"] for c in queue)
    assert all(c["progress"][-1]["action"] == "error" for c in queue)


def test_reset_clears_results_preserves_evidence_and_allows_new_runs(client):
    path, original = decide(client, "1000.01")
    assert (
        client.post(path + "/sign-off", json={"handler_id": "HND-01"}).status_code
        == 200
    )
    workflow.finish("CLM-1001", original["thread_id"], "")
    before = client.get(path).json()
    response = client.post("/api/claims/reset")
    assert response.status_code == 200
    assert response.json() == {"reset": 25}
    queue = client.get("/api/claims").json()
    assert len(queue) == 25
    for claim in queue:
        assert claim["status"] == "waiting"
        assert claim["decision"] is None
        assert claim["payment"] is None
        assert claim["sign_off"] is None
        assert claim["progress"] == []
        assert claim["thread_id"] is None
        assert claim["active"] is False
    after = client.get(path).json()
    for key in ("story", "items", "documents", "customer", "policy", "plan"):
        assert after[key] == before[key]
    assert len(client.get("/api/handlers").json()) == 3
    thread = client.post(path + "/run").json()["thread_id"]
    assert thread != original["thread_id"]
    assert client.post(path + "/decision", json=original).status_code == 409
    assert client.post(path + "/pay", json={"amount": "1000.01"}).status_code == 409
    workflow.finish("CLM-1001", thread, "")
    assert client.post("/api/claims/reset").json() == {"reset": 25}


def test_reset_is_blocked_during_active_runs_without_partial_changes(client):
    path, original = decide(client)
    assert client.post(path + "/pay", json={"amount": "1000"}).status_code == 200
    client.post("/api/claims/CLM-1002/run")
    before = client.get("/api/claims").json()
    assert client.post("/api/claims/reset").status_code == 409
    assert client.get("/api/claims").json() == before
    workflow.finish("CLM-1001", original["thread_id"], "")
    workflow.recover()
    assert client.post("/api/claims/reset").status_code == 200


def test_reset_rejects_batch_reservations(client):
    workflow.start_all()
    assert client.post("/api/claims/reset").status_code == 409
    assert all(c["active"] for c in client.get("/api/claims").json())

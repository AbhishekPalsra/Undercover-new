from fastapi.testclient import TestClient

from backend import store
from backend.main import app


def test_records(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "claims.db"))
    loaded = []
    original_load = store.load

    def tracked_load(name):
        loaded.append(name)
        return original_load(name)

    monkeypatch.setattr(store, "load", tracked_load)
    with TestClient(app) as client:
        queue = client.get("/api/claims").json()
        assert len(queue) == 25
        assert all(c["status"] == "waiting" for c in queue)
        claim = client.get("/api/claims/CLM-1001").json()
        assert claim["customer"]["name"] == "Maya Patel"
        assert len(claim["documents"]) == 4
        assert claim["amount_claimed"] == 420
        assert claim["customer"]["previous_claims"]
        assert client.get("/api/claims/missing").status_code == 404
        assert "## 12." in client.get("/api/policy-wording").json()["text"]
        assert len(client.get("/api/handlers").json()) == 3
        settings = client.get("/api/instructions").json()
        assert "$1,000.00" in settings["text"]
        assert set(loaded) == {
            "company.json",
            "plans.json",
            "policies.json",
            "customers.json",
            "handlers.json",
            "claims.json",
        }
        assert set(settings["company"]) == {"name", "currency", "payout_approval_limit"}
        with store.transaction() as db:
            record = store.claim_record(db, "CLM-1001")
            record["status"] = "decided"
            store.save(db, record)
        store.initialize()
        assert client.get("/api/claims/CLM-1001").json()["status"] == "decided"
        schema = client.get("/openapi.json").json()
        operations = [op for path in schema["paths"].values() for op in path.values()]
        assert len({op["operationId"] for op in operations}) == len(operations)
        assert all(p["required"] for op in operations for p in op.get("parameters", []))

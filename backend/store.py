"""SQLite records for the local pilot."""

import json
import os
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any

from fastapi import HTTPException

DATA = Path(__file__).resolve().parents[1] / "data"
INSTRUCTIONS = """You are the UnderCover Agent. Decide the supplied claim using only
the full policy wording, claim documents, policy, plan and customer history.
Approve, decline or refer. Refer when evidence is missing or the wording does not
settle the question; do not invent claims-manual rules.
Calculate eligible expenses, limits, compensation and applicable deductible in
the order specified in section 10. Record a two- or three-sentence reason and
relevant policy section, with a separate payout calculation.
Record zero for declines and referrals. Request simulated payment only for an
approval at or below the payout approval limit. Larger approvals need handler
sign-off. Never claim that approved money has been paid without a payment record."""


def connect() -> sqlite3.Connection:
    """Open the configured local database."""
    connection = sqlite3.connect(os.getenv("UNDERCOVER_DB", "undercover.db"))
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def transaction():
    """Serialize a workflow change and close its connection."""
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        yield connection


def load(name: str) -> Any:
    """Read a named seed resource."""
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def fresh_claim(claim: dict[str, Any]) -> dict[str, Any]:
    """Keep claim evidence and clear all pilot processing state."""
    return {
        **claim,
        "status": "waiting",
        "decision": None,
        "payment": None,
        "sign_off": None,
        "thread_id": None,
        "active": False,
        "progress": [],
    }


def initialize() -> None:
    """Seed only a fresh database."""
    with transaction() as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS resources (name TEXT PRIMARY KEY, body TEXT)"
        )
        db.execute("CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, body TEXT)")
        if db.execute("SELECT 1 FROM resources LIMIT 1").fetchone():
            return
        company = load("company.json")
        resources = {
            "company": {
                key: company[key]
                for key in ("name", "currency", "payout_approval_limit")
            },
            "plans": load("plans.json"),
            "policies": load("policies.json"),
            "customers": load("customers.json"),
            "handlers": load("handlers.json"),
            "wording": {
                "text": (DATA / "policy_wording.md").read_text(encoding="utf-8"),
                "version": company["policy_wording_version"],
            },
        }
        db.executemany(
            "INSERT INTO resources VALUES (?, ?)",
            [(key, json.dumps(value)) for key, value in resources.items()],
        )
        for seed in load("claims.json"):
            claim = fresh_claim(seed)
            db.execute(
                "INSERT INTO claims VALUES (?, ?)",
                (claim["claim_id"], json.dumps(claim)),
            )


def resource(db: sqlite3.Connection, name: str) -> Any:
    """Read a seeded resource."""
    return json.loads(
        db.execute("SELECT body FROM resources WHERE name = ?", (name,)).fetchone()[0]
    )


def claim_record(db: sqlite3.Connection, claim_id: str) -> dict[str, Any]:
    """Read one persisted claim."""
    row = db.execute("SELECT body FROM claims WHERE id = ?", (claim_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Claim not found")
    return json.loads(row[0])


def save(db: sqlite3.Connection, claim: dict[str, Any]) -> None:
    """Persist one claim."""
    db.execute(
        "UPDATE claims SET body = ? WHERE id = ?",
        (json.dumps(claim), claim["claim_id"]),
    )


def detail(db: sqlite3.Connection, claim_id: str) -> dict[str, Any]:
    """Assemble a claim and its linked records."""
    claim = claim_record(db, claim_id)
    policy = next(
        p for p in resource(db, "policies") if p["policy_id"] == claim["policy_id"]
    )
    customer = next(
        c for c in resource(db, "customers") if c["customer_id"] == claim["customer_id"]
    )
    plans = resource(db, "plans")
    plan = next(p for p in plans["plans"] if p["plan"] == policy["plan"])
    return {
        **claim,
        "outcome": claim["decision"]["outcome"] if claim["decision"] else None,
        "payment_status": (
            "paid"
            if claim["payment"]
            else "pending"
            if claim["decision"] and claim["decision"]["outcome"] == "approve"
            else "not_due"
        ),
        "policy": policy,
        "customer": customer,
        "plan": plan,
        "add_ons": [a for a in plans["add_ons"] if a["add_on"] in policy["add_ons"]],
    }

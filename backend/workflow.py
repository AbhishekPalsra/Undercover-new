"""Transactional claim decisions and simulated payments."""

import sqlite3
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field

from backend import store

Money = Annotated[Decimal, Field(ge=0, decimal_places=2, max_digits=12)]


class Payment(BaseModel):
    amount: Money


class Decision(Payment):
    thread_id: str
    outcome: Literal["approve", "decline", "refer"]
    calculation: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    policy_section: str = Field(min_length=1)


class Event(BaseModel):
    thread_id: str
    action: str
    message: str


class SignOff(BaseModel):
    handler_id: str


def require(condition: bool, message: str) -> None:
    """Reject a conflicting workflow action."""
    if not condition:
        raise HTTPException(409, message)


def event(record: dict[str, Any], action: str, message: str) -> None:
    """Append a visible activity entry."""
    record["progress"].append(
        {
            "sequence": len(record["progress"]) + 1,
            "thread_id": record["thread_id"],
            "time": datetime.now(UTC).isoformat(),
            "action": action,
            "message": message,
        }
    )


def start(claim_id: str) -> str:
    """Reserve a waiting claim for a single run."""
    with store.transaction() as db:
        record = store.claim_record(db, claim_id)
        require(
            record["status"] == "waiting" and not record["active"], "Claim cannot start"
        )
        reserve(db, record, "started", "Agent started")
        return record["thread_id"]


def reserve(
    db: sqlite3.Connection, record: dict[str, Any], action: str, message: str
) -> None:
    """Reserve a claim within the caller's transaction."""
    record.update(status="in_progress", active=True, thread_id=str(uuid4()))
    event(record, action, message)
    store.save(db, record)


def start_all() -> list[tuple[str, str]]:
    """Atomically reserve a snapshot of all waiting claims."""
    runs = []
    with store.transaction() as db:
        ids = db.execute("SELECT id FROM claims ORDER BY id").fetchall()
        for row in ids:
            record = store.claim_record(db, row[0])
            if record["status"] == "waiting" and not record["active"]:
                reserve(db, record, "queued", "Queued for agent review")
                runs.append((record["claim_id"], record["thread_id"]))
    return runs


def reset_all() -> int:
    """Clear processing state atomically when no claims are running."""
    with store.transaction() as db:
        records = [
            store.claim_record(db, row[0])
            for row in db.execute("SELECT id FROM claims").fetchall()
        ]
        require(
            not any(record["active"] for record in records),
            "Wait for all agent runs to finish before resetting claims",
        )
        for record in records:
            store.save(db, store.fresh_claim(record))
        return len(records)


def record_decision(claim_id: str, decision: Decision) -> None:
    """Save one decision for the current run."""
    with store.transaction() as db:
        record = store.claim_record(db, claim_id)
        require(
            record["active"] and record["thread_id"] == decision.thread_id,
            "Run is no longer active",
        )
        require(record["decision"] is None, "Decision already recorded")
        require(
            decision.outcome == "approve" or decision.amount == 0,
            "Declines and referrals must have zero payout",
        )
        saved = decision.model_dump(mode="json")
        saved["amount_cents"] = int(decision.amount * 100)
        record["decision"] = saved
        limit = Decimal(str(store.resource(db, "company")["payout_approval_limit"]))
        record["status"] = (
            "waiting_for_sign_off"
            if decision.outcome == "approve" and decision.amount > limit
            else "decided"
        )
        event(record, "decision", f"Decision recorded: {decision.outcome}")
        store.save(db, record)


def pay_record(db: sqlite3.Connection, record: dict[str, Any], amount: Decimal) -> None:
    """Enforce the payment gate inside the caller's transaction."""
    decision = record["decision"]
    if decision is None:
        raise HTTPException(409, "Only an approved claim can be paid")
    require(
        decision["outcome"] == "approve",
        "Only an approved claim can be paid",
    )
    require(record["payment"] is None, "Payment already recorded")
    require(int(amount * 100) == decision["amount_cents"], "Amount must match approval")
    limit = Decimal(str(store.resource(db, "company")["payout_approval_limit"]))
    require(
        amount <= limit or record["sign_off"] is not None, "Handler sign-off required"
    )
    record["payment"] = {
        "amount": str(amount),
        "amount_cents": int(amount * 100),
        "time": datetime.now(UTC).isoformat(),
    }
    event(record, "payment", "Simulated payment recorded")


def pay(claim_id: str, amount: Decimal) -> None:
    """Record an eligible payment exactly once."""
    with store.transaction() as db:
        record = store.claim_record(db, claim_id)
        pay_record(db, record, amount)
        store.save(db, record)


def sign_off(claim_id: str, handler_id: str) -> None:
    """Record handler attribution and release the approved payment."""
    with store.transaction() as db:
        record = store.claim_record(db, claim_id)
        handler = next(
            (
                h
                for h in store.resource(db, "handlers")
                if h["handler_id"] == handler_id
            ),
            None,
        )
        if handler is None:
            raise HTTPException(409, "Handler is not eligible")
        require(
            handler["can_approve_over_limit"],
            "Handler is not eligible",
        )
        require(record["status"] == "waiting_for_sign_off", "Claim needs no sign-off")
        record["sign_off"] = {
            "handler_id": handler_id,
            "name": handler["name"],
            "time": datetime.now(UTC).isoformat(),
        }
        record["status"] = "decided"
        event(record, "sign_off", f"Signed off by {handler['name']}")
        pay_record(db, record, Decimal(record["decision"]["amount"]))
        store.save(db, record)


def finish(claim_id: str, thread_id: str, error: str) -> None:
    """Complete a run without discarding saved work."""
    with store.transaction() as db:
        record = store.claim_record(db, claim_id)
        if record["thread_id"] != thread_id:
            return
        record["active"] = False
        if record["decision"] is None:
            record["status"] = "waiting"
            error = error or "Agent returned without a decision"
        event(record, "error" if error else "completed", error or "Agent finished")
        store.save(db, record)


def recover() -> None:
    """Mark runs interrupted by the previous process."""
    with store.transaction() as db:
        records = [
            store.claim_record(db, row[0])
            for row in db.execute("SELECT id FROM claims").fetchall()
        ]
    for record in records:
        if record["active"]:
            finish(
                record["claim_id"],
                record["thread_id"],
                "Run interrupted; retry available",
            )

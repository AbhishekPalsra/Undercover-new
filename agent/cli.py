"""Command-line access to the same claim operations as the dashboard."""

import argparse
import sys
import time
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

import httpx

from agent.main import backend


def parser() -> argparse.ArgumentParser:
    """Build the command-line interface."""
    root = argparse.ArgumentParser(description="Run or reset UnderCover claims.")
    commands = root.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Start one claim or all waiting claims")
    run.add_argument("claim_id", nargs="?", help="Claim ID, such as CLM-1001")
    run.add_argument(
        "--all",
        dest="all_claims",
        action="store_true",
        help="Process all waiting claims sequentially",
    )
    run.add_argument(
        "--wait",
        action="store_true",
        help="Wait for completion and print saved results",
    )
    reset = commands.add_parser(
        "reset", help="Clear processing results, keeping claim evidence"
    )
    reset.add_argument("--yes", action="store_true", help="Skip the reset confirmation")
    return root


def request(client: httpx.Client, path: str, *, post: bool) -> Any:
    """Call a backend operation and check its response."""
    response = client.post(path) if post else client.get(path)
    response.raise_for_status()
    return response.json()


def print_result(claim: dict[str, Any]) -> bool:
    """Print saved results and report whether the review succeeded."""
    decision = claim["decision"]
    errors = [
        e["message"]
        for e in claim["progress"]
        if e["action"] == "error" and e["thread_id"] == claim["thread_id"]
    ]
    print(f"{claim['claim_id']}: {claim['status'].replace('_', ' ')}")
    if not decision:
        print(f"  No decision saved. {errors[-1] if errors else 'Retry when ready.'}")
        return False
    print(
        f"  Outcome: {decision['outcome']}; "
        f"approved: ${Decimal(decision['amount']):,.2f}"
    )
    print(f"  Calculation: {decision['calculation']}")
    print(f"  Reason: {decision['reason']}")
    print(f"  Policy section: {decision['policy_section']}")
    payment = claim["payment"]
    if payment:
        print(f"  Simulated payment: ${Decimal(payment['amount']):,.2f}")
    elif decision["outcome"] == "approve":
        print("  Payment pending; check sign-off or retry payment in the dashboard.")
    models = dict.fromkeys(
        e["message"]
        for e in claim["progress"]
        if e["action"] == "model" and e["thread_id"] == claim["thread_id"]
    )
    if models:
        print("  Responding models: " + ", ".join(models))
    if errors:
        print("  Review error: " + errors[-1])
    return not errors


def wait_for_results(client: httpx.Client, claim_id: str | None) -> int:
    """Wait until selected work is inactive, then print its saved results."""
    path = f"/api/claims/{claim_id}" if claim_id else "/api/claims"
    while True:
        result = request(client, path, post=False)
        claims = [result] if claim_id else result
        if not any(claim["active"] for claim in claims):
            successes = [print_result(claim) for claim in claims]
            return 0 if all(successes) else 1
        time.sleep(1)


def run_claims(client: httpx.Client, args: argparse.Namespace) -> int:
    """Start backend processing and optionally wait for the results."""
    path = "/api/claims/run" if args.all_claims else f"/api/claims/{args.claim_id}/run"
    result = request(client, path, post=True)
    if args.all_claims:
        print(f"Queued {result['queued']} waiting claims.")
    else:
        print(f"Started {args.claim_id}. Thread: {result['thread_id']}")
    if args.wait:
        print("Waiting for backend processing. Press Ctrl+C to stop waiting.")
        return wait_for_results(client, args.claim_id)
    print(
        "Processing continues in the backend. Follow Agent activity in the dashboard."
    )
    return 0


def reset_claims(client: httpx.Client, confirmed: bool) -> int:
    """Confirm and reset claim processing state through the API."""
    if not confirmed:
        print("This clears decisions, activity, sign-offs and simulated payments.")
        if input(
            "Reset all claims, keeping their documents? [y/N] "
        ).strip().lower() not in {"y", "yes"}:
            print("Reset canceled.")
            return 0
    result = request(client, "/api/claims/reset", post=True)
    print(f"Reset {result['reset']} claims to waiting. Claim evidence was preserved.")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run a CLI command and report actionable errors."""
    root = parser()
    args = root.parse_args(argv)
    if args.command == "run" and bool(args.claim_id) == args.all_claims:
        root.error("Choose a claim ID or --all, but not both.")
    try:
        with backend() as client:
            if args.command == "reset":
                return reset_claims(client, args.yes)
            return run_claims(client, args)
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        if "application/json" in exc.response.headers.get("content-type", ""):
            detail = str(exc.response.json().get("detail", detail))
        print(
            f"Backend rejected the request ({exc.response.status_code}): {detail}",
            file=sys.stderr,
        )
        return 1
    except httpx.RequestError:
        print(
            "Cannot reach the backend. Start npm run dev or the backend server first; "
            "check BACKEND_URL.",
            file=sys.stderr,
        )
        return 1
    except (KeyboardInterrupt, EOFError):
        print(
            "Command interrupted. Any started backend processing continues.",
            file=sys.stderr,
        )
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

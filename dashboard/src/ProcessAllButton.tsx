import { useState } from "react";
import { type Claim, request } from "./api";

interface Props {
  claims: Claim[];
  refresh: () => Promise<void>;
}

export function ProcessAllButton({ claims, refresh }: Readonly<Props>) {
  const [pending, setPending] = useState<"run" | "reset" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const active = claims.some((claim) => claim.active);
  const waiting = claims.some(
    (claim) => claim.status === "waiting" && !claim.active,
  );
  async function perform(action: "run" | "reset") {
    setPending(action);
    setError("");
    setMessage("");
    try {
      if (action === "reset") {
        const result = await request<{ reset: number }>("/claims/reset", {});
        setMessage(
          `Claims reset. All ${String(result.reset)} claims are waiting.`,
        );
        setConfirmReset(false);
      } else {
        await request<{ queued: number }>("/claims/run", {});
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update claims.");
    } finally {
      setPending(null);
    }
  }
  const disabled = pending !== null || active;
  return (
    <div className="queue-actions">
      <div className="queue-buttons">
        <button
          disabled={disabled || !waiting || confirmReset}
          onClick={() => {
            void perform("run");
          }}
        >
          {pending === "run" || active
            ? "Processing claims…"
            : "Process all claims"}
        </button>
        <button
          className="secondary-button"
          disabled={disabled || claims.length === 0}
          onClick={() => {
            setConfirmReset(true);
            setMessage("");
            setError("");
          }}
        >
          Reset claims
        </button>
      </div>
      <small>
        Reviews every waiting claim. Payouts over $1,000 need sign-off.
      </small>
      {confirmReset && (
        <div
          className="reset-confirmation"
          role="group"
          aria-label="Reset claims confirmation"
        >
          <strong>Reset all claims?</strong>
          <p>
            This clears decisions, activity, sign-offs and simulated payments.
            Claim documents are kept.
          </p>
          <div className="queue-buttons">
            <button
              disabled={disabled}
              onClick={() => {
                void perform("reset");
              }}
            >
              {pending === "reset" ? "Resetting claims…" : "Reset all claims"}
            </button>
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={() => {
                setConfirmReset(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

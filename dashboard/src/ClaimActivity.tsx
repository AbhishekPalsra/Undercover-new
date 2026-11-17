import { type Claim, label } from "./api";

export function ClaimActivity({ claim }: Readonly<{ claim: Claim }>) {
  const current = claim.progress.filter(
    (event) => event.thread_id === claim.thread_id,
  );
  const requested = current.find((event) => event.action === "model_requested");
  const models = [
    ...new Set(
      current
        .filter((event) => event.action === "model")
        .map((event) => event.message),
    ),
  ];
  const missing = current.some((event) => event.action === "model_unreported");
  return (
    <section className="panel agent-panel" aria-label="Agent activity">
      <div className="activity-heading">
        <h2>Agent activity</h2>
        {claim.active && <span className="live-indicator">Live</span>}
      </div>
      <div
        className="model-summary"
        role="group"
        aria-label="Model for this review"
      >
        <p className="eyebrow">MODEL FOR THIS REVIEW</p>
        {requested && (
          <>
            <span className="model-label">Requested model or route</span>
            <code>{requested.message}</code>
          </>
        )}
        {models.length > 0 && (
          <>
            <span className="model-label">
              Responding {models.length === 1 ? "model" : "models"}
            </span>
            {models.map((name) => (
              <code key={name}>{name}</code>
            ))}
          </>
        )}
        {models.length === 0 && (
          <p>
            {requested && claim.active
              ? "Waiting for a model response…"
              : "The responding model was not recorded for this review."}
          </p>
        )}
        {missing && models.length > 0 && (
          <small>Some replies did not include a model name.</small>
        )}
        {models.some((name) => name.startsWith("test/")) && (
          <small>Scripted test model · no live AI call</small>
        )}
      </div>
      {claim.active && <p role="status">Review in progress…</p>}
      {claim.progress.length === 0 && <p>No activity yet.</p>}
      <ol className="activity">
        {claim.progress.map((event) => (
          <li
            key={event.sequence}
            className={event.action === "error" ? "error" : ""}
          >
            <strong>
              {event.action === "model"
                ? "Model responded"
                : label(event.action)}
            </strong>
            <p
              className={
                event.action.startsWith("model") ? "model-event" : undefined
              }
            >
              {event.message}
            </p>
            <time dateTime={event.time}>
              {new Date(event.time).toLocaleTimeString()}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

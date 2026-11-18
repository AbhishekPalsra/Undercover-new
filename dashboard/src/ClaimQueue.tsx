import { useState } from "react";
import { type Claim, label, money } from "./api";
import { ProcessAllButton } from "./ProcessAllButton";

interface Props {
  claims: Claim[];
  refresh: () => Promise<void>;
}

function paymentLabel(claim: Claim) {
  if (claim.payment) return "Paid (simulated)";
  return claim.decision?.outcome === "approve"
    ? "Payment pending"
    : "No payment due";
}

export function ClaimQueue({ claims, refresh }: Readonly<Props>) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const query = search.trim().toLowerCase();
  const visible = claims.filter(
    (claim) =>
      (!status || claim.status === status) &&
      [claim.claim_id, claim.customer.name, claim.summary, claim.claim_type]
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">YOUR CLAIMS WORKSPACE</p>
          <h1>Every journey. Every claim.</h1>
          <p>
            A little clarity for every journey.
            <br />
            Review claims and follow your agent's work, all in one place.
          </p>
        </div>
        <ProcessAllButton claims={claims} refresh={refresh} />
      </div>
      <div className="stats" role="group" aria-label="Filter claims by status">
        {["waiting", "in_progress", "waiting_for_sign_off", "decided"].map(
          (value) => (
            <button
              className={"stat " + value}
              key={value}
              aria-label={"Filter by " + label(value)}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(status === value ? "" : value);
              }}
            >
              <span className="stat-label">
                <span className="status-dot" aria-hidden="true" />
                {label(value)}
              </span>
              <strong>{claims.filter((c) => c.status === value).length}</strong>
              <span className="stat-hint">
                View claims <span aria-hidden="true">↗</span>
              </span>
            </button>
          ),
        )}
      </div>
      <section className="panel queue">
        <div className="queue-heading">
          <div>
            <p className="eyebrow">THE OVERVIEW</p>
            <h2>Claims queue</h2>
          </div>
          <span className="count">{claims.length} claims</span>
        </div>
        <div className="queue-filters">
          <label>
            <span>Search claims</span>
            <input
              type="search"
              value={search}
              placeholder="Claim ID, customer or incident"
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </label>
          <label>
            <span>Queue status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
              }}
            >
              <option value="">All statuses</option>
              {[
                "waiting",
                "in_progress",
                "waiting_for_sign_off",
                "decided",
              ].map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          {(search || status) && (
            <button
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setStatus("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <p className="results-count" role="status">
          Showing {visible.length} of {claims.length}
        </p>
        {claims.length > 0 && visible.length === 0 && (
          <p>No claims match your search.</p>
        )}
        {claims.length === 0 && <p>No claims in the queue.</p>}
        <div className="table-scroll">
          <table aria-label="Claims queue">
            <thead>
              <tr>
                <th>Claim / customer</th>
                <th>What happened</th>
                <th>Amount claimed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.claim_id}>
                  <td className="claim-person">
                    <span className="avatar" aria-hidden="true">
                      {item.customer.name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div>
                      <a href={"#" + item.claim_id}>{item.claim_id}</a>
                      <span className="customer">{item.customer.name}</span>
                    </div>
                  </td>
                  <td className="claim-summary">
                    {item.summary}
                    <small>{label(item.claim_type)}</small>
                  </td>
                  <td className="numeric" data-label="Amount claimed">
                    {money(item.amount_claimed)}
                  </td>
                  <td className="claim-status">
                    <span className={"badge " + item.status}>
                      {label(item.status)}
                    </span>
                    {item.decision && (
                      <small>
                        {label(item.decision.outcome)} · {paymentLabel(item)}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

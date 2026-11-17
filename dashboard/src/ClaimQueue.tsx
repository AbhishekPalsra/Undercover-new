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
          <p className="eyebrow">CLAIMS OPERATIONS</p>
          <h1>Every journey. Every claim.</h1>
          <p>Review the queue and follow the UnderCover Agent's work.</p>
        </div>
        <ProcessAllButton claims={claims} refresh={refresh} />
      </div>
      <div className="stats">
        {["waiting", "in_progress", "waiting_for_sign_off", "decided"].map(
          (status) => (
            <div className={"stat " + status} key={status}>
              <span>{label(status)}</span>
              <strong>
                {claims.filter((c) => c.status === status).length}
              </strong>
            </div>
          ),
        )}
      </div>
      <section className="panel queue">
        <h2>
          Claims queue <span className="count">· {claims.length} claims</span>
        </h2>
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
        <p className="results-count">
          Showing {visible.length} of {claims.length}
        </p>
        {claims.length > 0 && visible.length === 0 && (
          <p>No claims match your search.</p>
        )}
        {claims.length === 0 && <p>No claims in the queue.</p>}
        <div className="table-scroll">
          <table>
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
                  <td>
                    <a href={"#" + item.claim_id}>{item.claim_id}</a>
                    <span className="customer">{item.customer.name}</span>
                  </td>
                  <td>
                    {item.summary}
                    <small>{label(item.claim_type)}</small>
                  </td>
                  <td className="numeric">{money(item.amount_claimed)}</td>
                  <td>
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

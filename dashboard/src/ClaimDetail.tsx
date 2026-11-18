import { useState } from "react";
import { label, money, type Claim, type Handler } from "./api";
import { ClaimActivity } from "./ClaimActivity";
import { Records } from "./Records";

interface Props {
  claim: Claim;
  handlers: Handler[];
  busy: boolean;
  act: (action: string, body: object) => void;
}

export function ClaimDetail({ claim, handlers, busy, act }: Readonly<Props>) {
  const [handler, setHandler] = useState("");
  const decision = claim.decision;
  return (
    <>
      <section className="panel claim-heading">
        <div className="claim-intro">
          <p className="eyebrow">CLAIM / {claim.claim_id}</p>
          <h1>{claim.summary}</h1>
          <p>
            {claim.customer.name} · {label(claim.claim_type)}
          </p>
        </div>
        <div className="claim-amount">
          <span className={"badge " + claim.status}>{label(claim.status)}</span>
          <p className="amount">{money(claim.amount_claimed)}</p>
          <small>Amount claimed</small>
        </div>
        {claim.status === "waiting" && !claim.active && (
          <button
            disabled={busy}
            onClick={() => {
              act("run", {});
            }}
          >
            Process claim
          </button>
        )}
      </section>
      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>What happened</h2>
            <p className="story">{claim.story}</p>
            <dl className="facts">
              <div>
                <dt>Incident</dt>
                <dd>
                  {claim.incident_date} · {claim.incident_location}
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{claim.submitted_on}</dd>
              </div>
            </dl>
            <h3>Claimed items</h3>
            {claim.items.map((item, index) => (
              <div className="item" key={index}>
                <span>{item.description}</span>
                <strong>{money(item.amount)}</strong>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Supporting documents</h2>
            {claim.documents.map((doc, index) => (
              <details key={index} open>
                <summary>{doc.name}</summary>
                <p className="document">{doc.content}</p>
              </details>
            ))}
          </section>
          <section className="panel">
            <h2>Policy and customer</h2>
            <details>
              <summary>Policy and travelers</summary>
              <Records value={claim.policy} />
            </details>
            <details>
              <summary>Plan limits and add-ons</summary>
              <Records value={claim.plan} />
              <Records value={claim.add_ons} />
            </details>
            <details>
              <summary>Customer and claim history</summary>
              <Records value={claim.customer} />
            </details>
          </section>
        </div>
        <aside>
          <section className="panel decision-panel">
            <p className="eyebrow">UNDERCOVER AGENT</p>
            <h2>Decision</h2>
            {decision ? (
              <>
                <h3>{label(decision.outcome)}</h3>
                <p>{decision.reason}</p>
                <p className="citation">
                  Policy section {decision.policy_section}
                </p>
                <h3>Calculation</h3>
                <p>{decision.calculation}</p>
                <div className="item">
                  <span>Approved</span>
                  <strong>{money(decision.amount)}</strong>
                </div>
                <div className="item">
                  <span>Paid · simulated</span>
                  <strong>{money(claim.payment?.amount ?? 0)}</strong>
                </div>
                {claim.sign_off && (
                  <p>
                    Signed off by {claim.sign_off.name} ·{" "}
                    {new Date(claim.sign_off.time).toLocaleString()}
                  </p>
                )}
                {claim.status === "waiting_for_sign_off" && (
                  <div className="sign-off">
                    <p>Payment is blocked until a handler signs off.</p>
                    <label htmlFor="handler">Handler</label>
                    <select
                      id="handler"
                      value={handler}
                      onChange={(e) => {
                        setHandler(e.target.value);
                      }}
                    >
                      <option value="">Select a handler</option>
                      {handlers
                        .filter((h) => h.can_approve_over_limit)
                        .map((h) => (
                          <option key={h.handler_id} value={h.handler_id}>
                            {h.name}
                          </option>
                        ))}
                    </select>
                    <button
                      disabled={busy || !handler}
                      onClick={() => {
                        act("sign-off", { handler_id: handler });
                      }}
                    >
                      Sign off and pay
                    </button>
                  </div>
                )}
                {decision.outcome === "approve" &&
                  claim.status === "decided" &&
                  !claim.payment && (
                    <button
                      disabled={busy || claim.active}
                      onClick={() => {
                        act("pay", { amount: decision.amount });
                      }}
                    >
                      Retry payment
                    </button>
                  )}
              </>
            ) : (
              <p>
                The agent's decision will appear here once it has reviewed the
                claim.
              </p>
            )}
          </section>
          <ClaimActivity claim={claim} />
        </aside>
      </div>
    </>
  );
}

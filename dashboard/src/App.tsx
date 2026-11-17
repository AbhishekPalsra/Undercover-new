import { useCallback, useEffect, useState } from "react";
import { type Claim, type Handler, type Instructions, request } from "./api";
import { ClaimQueue } from "./ClaimQueue";
import { ClaimDetail } from "./ClaimDetail";
import "./style.css";

export function App() {
  const [view, setView] = useState(() => window.location.hash.slice(1));
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const claimPath =
        "/claims" + (view ? "/" + encodeURIComponent(view) : "");
      const path = view === "instructions" ? "/instructions" : claimPath;
      const result = await request<Claim | Claim[] | Instructions>(path);
      if (window.location.hash.slice(1) !== view) return;
      if (Array.isArray(result)) setClaims(result);
      else if ("text" in result) setInstructions(result.text);
      else setClaim(result);
      setError("");
    } catch (err) {
      if (window.location.hash.slice(1) === view)
        setError(
          err instanceof Error ? err.message : "Unable to load records.",
        );
    } finally {
      if (window.location.hash.slice(1) === view) setLoading(false);
    }
  }, [view]);
  useEffect(() => {
    const change = () => {
      if (window.location.hash.slice(1) === view) return;
      setView(window.location.hash.slice(1));
      setLoading(true);
      setClaim(null);
    };
    window.addEventListener("hashchange", change);
    return () => {
      window.removeEventListener("hashchange", change);
    };
  }, [view]);
  const polling = view
    ? Boolean(claim?.active)
    : claims.some((item) => item.active);
  useEffect(() => {
    void Promise.resolve().then(load);
    void request<Handler[]>("/handlers")
      .then(setHandlers)
      .catch(() => {
        setError("Unable to load handlers.");
      });
    if (!polling) return;
    const timer = window.setInterval(() => {
      void load();
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [load, polling]);
  async function act(action: string, body: object) {
    setBusy(true);
    try {
      await request<unknown>("/claims/" + view + "/" + action, body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shell">
      <Header view={view} />
      <main>
        {view && (
          <a className="back" href="/#">
            ← Claims queue
          </a>
        )}
        {error && (
          <p className="error panel" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading records…</p>
        ) : (
          <>
            {view === "instructions" && (
              <section className="panel instructions">
                <p className="eyebrow">UNDERCOVER AGENT / READ ONLY</p>
                <h1>Agent instructions</h1>
                <p>
                  These are the instructions supplied to the agent for each
                  claim.
                </p>
                <pre>{instructions}</pre>
              </section>
            )}
            {!view && <ClaimQueue claims={claims} refresh={load} />}
            {view !== "instructions" && claim && (
              <ClaimDetail
                claim={claim}
                handlers={handlers}
                busy={busy}
                act={(action, body) => {
                  void act(action, body);
                }}
              />
            )}
          </>
        )}
      </main>
      <footer>
        UnderCover Travel Insurance{" "}
        <span>All amounts in USD · Payments are simulated</span>
      </footer>
    </div>
  );
}

function Header({ view }: Readonly<{ view: string }>) {
  return (
    <header>
      <a className="wordmark" href="/#">
        undercover<span> / travel insurance</span>
      </a>
      <nav aria-label="Main">
        <a href="/#" aria-current={!view ? "page" : undefined}>
          Claims queue
        </a>
        <a
          href="#instructions"
          aria-current={view === "instructions" ? "page" : undefined}
        >
          Agent instructions
        </a>
      </nav>
      <span className="pilot">Claims pilot</span>
    </header>
  );
}

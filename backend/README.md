# UnderCover pilot

Run these commands from the repository root with Python 3.12, uv and Node 26:

```sh
uv sync
npm install
npm run dev
```

Open http://localhost:5173. FastAPI's API documentation is at http://localhost:8000/docs.

Set `OPENAI_API_KEY` in the root `.env`. The agent connects directly to OpenAI and defaults to `gpt-5-mini` with low reasoning effort. This workspace also selects `MODEL_NAME=gpt-5-mini` explicitly in `.env`. Set `MODEL_NAME` to select another OpenAI model, using its API model ID without an `openai/` prefix. GPT-5 mini always uses low reasoning effort; other models use their default reasoning settings. Keys stay on the backend. Model selection is in `agent/main.py` (`DEFAULT_MODEL` and `model()`). Each model request is capped at 8,192 response tokens, including reasoning where applicable, for both the default and overridden model. Restart the app after changing agent configuration, then retry waiting claims.

Choose **Process all claims** on the queue to review every waiting claim sequentially in the background. Progress updates automatically, and processing continues if you leave the page. Claims already running or decided are skipped. A failed claim does not stop the remaining queue; unfinished claims can be retried after the batch ends.

To review one claim, open it and choose **Process claim**. The activity list updates while the agent works. It records the requested route and the responding model names reported by API replies, including changes between calls. Missing model metadata and older reviews are labeled as unrecorded; reset and process again to capture names for a fresh review. Queue search and status filters help find claims, and payment labels distinguish pending approvals from paid or not-due amounts. Approvals over $1,000 wait for a handler selected in the sign-off control; all payments are simulated. An unpaid approval can retry payment without repeating the decision. Handler selection provides attribution, not authentication.

To start over, choose **Reset claims** on the queue, then **Reset all claims** in the confirmation. This clears decisions, activity, sign-offs and simulated payments and returns the claims to Waiting. It preserves the original documents, policies and customer history. Reset is blocked while any claim is active. Afterward, click **Process all claims** to review them again.

Records are seeded once into `undercover.db` in the root. `UNDERCOVER_DB` can select a different SQLite path; `BACKEND_URL` selects the API address used by the agent and Vite proxy. Stop the app before moving a database. A new database path starts a fresh queue without changing seed files.

Interrupted runs return to waiting if no decision was saved. Saved decisions, sign-offs and payments survive restart. Interrupted agent execution restarts from scratch rather than resuming its model conversation.

Run `npm run check` for every check, including 80% coverage gates and Playwright. End-to-end checks use ports 8123/5175, a temporary database and a scripted model; they never use the development database, reuse its server or call a model provider. The launcher removes its database on exit. `UNDERCOVER_STUB=1` is for synthetic workflow tests only and is not an accuracy demonstration. Test gate controls exist only in `backend.testing_api:app`, not the normal `backend.main:app`.

The manual, evaluation answer keys and held-out claims are outside this pilot. No accuracy score has been measured against handler decisions.

For a plain-language explanation with diagrams and a code tour, read the [project guide](../docs/README.md).

## Terminal commands

Keep `npm run dev` running. From a second terminal in the repository root:

```sh
uv run -m agent.cli reset --yes
uv run -m agent.cli run CLM-1001 --wait
uv run -m agent.cli run --all --wait
```

The first command clears processing results and preserves claim evidence. Omit `--yes` for an interactive confirmation. The other two commands run one claim or all waiting claims; use reset first if you want to reprocess completed claims. Omit `--wait` to return immediately after starting work. Reset is blocked during active work, and payment sign-off rules still apply.

Use `uv run -m agent.cli --help` for options. For terminal-only use, start `uv run -m uvicorn backend.main:app --port 8000` instead of `npm run dev`. These commands work on macOS and PowerShell. See the [full CLI guide](../docs/README.md#terminal-commands) for results, exit codes and backend configuration.

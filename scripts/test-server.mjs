import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "undercover-test-"));
const child = spawn("uv", ["run", "-m", "uvicorn", "backend.testing_api:app", "--port", "8123"], {
  stdio: "inherit",
  env: { ...process.env, UNDERCOVER_DB: join(directory, "claims.db"), UNDERCOVER_STUB: "1", UNDERCOVER_STUB_GATE: "1", BACKEND_URL: "http://127.0.0.1:8123" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { rmSync(directory, { recursive: true, force: true }); process.exit(code ?? 0); });

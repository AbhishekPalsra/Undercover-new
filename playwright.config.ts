import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  reporter: "list",
  workers: 1,
  use: { baseURL: "http://localhost:5175" },
  webServer: [
    {
      command: "node scripts/test-server.mjs",
      url: "http://127.0.0.1:8123/api/health",
      reuseExistingServer: false,
    },
    {
      command: "npx vite dashboard --port 5175 --strictPort",
      env: { BACKEND_URL: "http://127.0.0.1:8123" },
      url: "http://localhost:5175",
      reuseExistingServer: false,
    },
  ],
});

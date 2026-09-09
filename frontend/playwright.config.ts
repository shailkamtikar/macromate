import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  // AI-feature specs call the real Gemini API, which has inherent
  // response variance (occasionally mis-parses a test fixture's phrasing
  // even when the code path is correct) — one retry absorbs that without
  // masking a real regression, which would fail consistently.
  retries: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Servers are started explicitly by the test runner invocation, not here,
  // since the backend also needs to be up (webServer only manages one process).
});

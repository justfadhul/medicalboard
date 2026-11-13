import { defineConfig, devices } from "@playwright/test";

// E2E against a local Supabase (`supabase start`) and `next start`. Uses Chromium's fake camera stream and the mock SMS provider.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["Desktop Chrome"],
    permissions: ["camera"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run start", url: "http://localhost:3000/login", timeout: 120_000, reuseExistingServer: true },
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e-integration",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});

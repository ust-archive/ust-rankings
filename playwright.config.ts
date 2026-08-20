import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-test",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun --bun next dev --turbopack --hostname 127.0.0.1 --port 3210",
    url: "http://127.0.0.1:3210/schedule",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

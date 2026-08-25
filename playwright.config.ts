import { defineConfig, devices } from "@playwright/test";
import { browserContributionsUrl } from "./test/browser-contributions-fixture";
import { browserFixtureEnvironment } from "./test/browser-fixture";

const port = 17831;

export default defineConfig({
  testDir: "./test/browser",
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  workers: process.env.CI ? 1 : 6,
  reporter: process.env.CI ? "github" : "list",
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/serve-browser-delivery.ts",
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${browserFixtureEnvironment.NEXT_PUBLIC_DELIVERY_BASE_URL}/latest.json`,
    },
    {
      command: `npm run dev -- --port ${port}`,
      env: {
        ...process.env,
        AUTH_SECRET: "",
        CONTRIBUTIONS_POSTGRES_URL: browserContributionsUrl(),
        NEXT_DIST_DIR: ".next-playwright",
        ...browserFixtureEnvironment,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: `http://localhost:${port}/rankings/courses`,
    },
  ],
});

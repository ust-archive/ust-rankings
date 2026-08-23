import { defineConfig, devices } from "@playwright/test";
import { browserContributionsUrl } from "./test/browser-contributions-fixture";
import { browserFixtureEnvironment } from "./test/browser-fixture";

const port = 17831;

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
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
});

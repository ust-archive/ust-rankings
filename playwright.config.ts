import { defineConfig, devices } from "@playwright/test";

// Version labels only: browser tests exercise policy gating, not approved legal text.
const nonProductionPolicyVersions = {
  PRIVACY_POLICY_VERSION: "privacy-browser-test-v1",
  COMMUNITY_RULES_VERSION: "community-browser-test-v1",
  REVIEW_POLICY_VERSION: "review-browser-test-v1",
};
Object.assign(process.env, nonProductionPolicyVersions);

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
    env: {
      ...(process.env as Record<string, string>),
      ...nonProductionPolicyVersions,
    },
    url: "http://127.0.0.1:3210/schedule",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

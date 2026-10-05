import { defineConfig, devices } from "@playwright/test";

// Run against a production build, a disposable database, and real public data.
if (!process.env.PREFETCH_BASE_URL || !process.env.PREFETCH_RUNTIME_LOG)
  throw new Error(
    "Set PREFETCH_BASE_URL and PREFETCH_RUNTIME_LOG; see docs/database-diagnostics.md",
  );

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "prefetch.production.spec.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PREFETCH_BASE_URL,
    trace: "retain-on-failure",
  },
});

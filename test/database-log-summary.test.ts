import { expect, it } from "vitest";
import {
  compareUsage,
  summarizeDatabaseLogs,
} from "../scripts/summarize-database-logs.ts";

it("summarizes captured operations while exposing duplicates, incomplete capture, and invalid records", async () => {
  const base = {
    event: "database-operation",
    version: 1,
    processId: "process",
    deployment: "build",
    operation: "reviews.listReviews",
    caller: "course",
    intent: "read",
    authentication: "anonymous",
    requestClass: "rsc-unknown",
  };
  const event = (operationId: string, timestamp: string, rest: object) =>
    `[web] ${JSON.stringify({ ...base, operationId, timestamp: `2026-09-24T${timestamp}Z`, ...rest })}`;
  const attempt = event("a", "01:00:00", { phase: "attempt" });
  const report = await summarizeDatabaseLogs(
    [
      "ordinary log",
      attempt,
      attempt,
      event("a", "01:00:01", {
        phase: "complete",
        outcome: "success",
        durationMs: 1000,
      }),
      event("b", "01:10:00", { phase: "attempt" }),
      event("c", "01:11:00", {
        phase: "complete",
        outcome: "error",
        errorCategory: "quota-exceeded",
        durationMs: 20,
      }),
      '{"event":"database-operation","version":2}',
      '{"event":"database-operation",broken',
    ],
    { from: "2026-09-24T01:00:00Z", to: "2026-09-24T02:00:00Z" },
  );
  expect(report.counts).toMatchObject({
    attempts: 2,
    completions: 2,
    successes: 1,
    errors: 1,
    duplicates: 1,
    malformed: 1,
    unsupported: 1,
    unmatchedAttempts: 1,
    unmatchedCompletions: 1,
  });
  expect(report.groups[0]).toMatchObject({
    caller: "course",
    attempts: 2,
    completions: 2,
  });
  expect(report.largestObservedAttemptGapSeconds).toBe(600);
  expect(report.coverage).toContain("not proof of database inactivity");
});

it("compares billing counters only across matching scope and interval", () => {
  const before = {
    timestamp: "2026-09-24T01:00:00Z",
    scope: "project/production/2026-09",
    compute_time_seconds: 3600,
    active_time_seconds: 7200,
  };
  const after = {
    ...before,
    timestamp: "2026-09-24T02:00:00Z",
    compute_time_seconds: 4500,
    active_time_seconds: 10800,
  };
  const window = { from: before.timestamp, to: after.timestamp };
  expect(compareUsage(before, after, window)).toEqual({
    computeHours: 0.25,
    activeHours: 1,
    scope: before.scope,
  });
  expect(() =>
    compareUsage(before, { ...after, scope: "other" }, window),
  ).toThrow();
  expect(() =>
    compareUsage(before, { ...after, compute_time_seconds: 0 }, window),
  ).toThrow();
});

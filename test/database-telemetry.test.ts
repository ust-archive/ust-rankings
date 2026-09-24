import { afterEach, expect, it, vi } from "vitest";
import { createReviewService } from "@/lib/contributions/reviews";
import {
  observeDatabaseOperation,
  observeDatabaseService,
} from "@/lib/database-telemetry";

afterEach(() => vi.restoreAllMocks());

it("logs an owned Review read without logging its inputs or changing its result", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const repository = { listReviews: vi.fn(async () => []) };
  const service = observeDatabaseService(
    createReviewService(repository as never, {} as never),
    "reviews",
    {
      listReviews: "read",
      getReview: "read",
      publishReview: "write",
      editReview: "write",
      withdrawReview: "write",
    },
    async () => ({
      caller: "course",
      authentication: "anonymous",
      requestClass: "rsc-unknown",
    }),
  );
  const result = await service.listReviews({
    type: "course",
    coursePrefix: "SECRET",
    courseNumber: "1234",
  });
  expect(result).toEqual([]);
  expect(repository.listReviews).toHaveBeenCalledTimes(1);
  const events = output.mock.calls.map(([line]) => JSON.parse(line));
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    event: "database-operation",
    phase: "attempt",
    operation: "reviews.listReviews",
    caller: "course",
    intent: "read",
    authentication: "anonymous",
    requestClass: "rsc-unknown",
  });
  expect(events[1]).toMatchObject({
    phase: "complete",
    operationId: events[0].operationId,
    outcome: "success",
  });
  expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(events)).not.toContain("SECRET");
});

it("keeps concurrent callers separate and preserves wrapped quota errors", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const first = Promise.withResolvers<void>();
  const failure = new Error("contains private connection info", {
    cause: { code: "53000" },
  });
  const course = observeDatabaseOperation(
    { operation: "reviews.listReviews", caller: "course", intent: "read" },
    () => first.promise,
  );
  await expect(
    observeDatabaseOperation(
      {
        operation: "accounts.getUser",
        caller: "account.header",
        intent: "read",
      },
      async () => {
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
  first.resolve();
  await course;
  const events = output.mock.calls.map(([line]) => JSON.parse(line));
  expect(events.map((event) => [event.caller, event.phase])).toEqual([
    ["course", "attempt"],
    ["account.header", "attempt"],
    ["account.header", "complete"],
    ["course", "complete"],
  ]);
  expect(events[2]).toMatchObject({
    outcome: "error",
    errorCategory: "quota-exceeded",
  });
  expect(JSON.stringify(events)).not.toContain("private");
});

it("does not retry, swallow errors, or fail successful work when logging fails", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {
    throw new Error("log unavailable");
  });
  const work = vi.fn(async () => 42);
  expect(
    await observeDatabaseOperation(
      { operation: "test", caller: "unknown", intent: "read" },
      work,
    ),
  ).toBe(42);
  expect(work).toHaveBeenCalledTimes(1);
  const failure = new Error("original");
  await expect(
    observeDatabaseOperation(
      { operation: "test", caller: "unknown", intent: "read" },
      async () => {
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
});

it("preserves the original error even when inspecting it throws", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const original = Object.defineProperty(new Error("original"), "code", {
    get() {
      throw new Error("inspection failed");
    },
  });
  await expect(
    observeDatabaseOperation(
      { operation: "test", caller: "unknown", intent: "read" },
      async () => {
        throw original;
      },
    ),
  ).rejects.toBe(original);
  expect(JSON.parse(output.mock.calls.at(-1)?.[0] as string)).toMatchObject({
    outcome: "error",
    errorCategory: "other",
  });
});

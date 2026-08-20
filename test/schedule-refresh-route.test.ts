import { afterEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const secret = "correct-secret-with-enough-entropy";
const cronSecret = "distinct-cron-secret-with-enough-entropy";

afterEach(() => {
  delete process.env.SCHEDULE_REFRESH_SECRET;
  delete process.env.CRON_SECRET;
});

test("distinct daily and manual secrets invoke the intended Schedule refresh", async () => {
  process.env.CRON_SECRET = cronSecret;
  process.env.SCHEDULE_REFRESH_SECRET = secret;
  const calls: Array<{ sha?: string }> = [];
  const operation = mock(async (options: { sha?: string }) => {
    calls.push(options);
    return {
      status: "activated" as const,
      generation: options.sha ?? "latest",
    };
  });
  const { createScheduleRefreshHandlers } = await import(
    "@/app/api/schedule/refresh/route"
  );
  const handlers = createScheduleRefreshHandlers(operation);
  const daily = await handlers.GET(
    new Request("https://example.test/api/schedule/refresh", {
      headers: { authorization: `Bearer ${cronSecret}` },
    }),
  );
  const pinned = await handlers.POST(
    new Request("https://example.test/api/schedule/refresh", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sha: "0123456789abcdef0123456789abcdef01234567",
      }),
    }),
  );

  expect(daily.status).toBe(200);
  expect(pinned.status).toBe(200);
  expect(
    (
      await handlers.GET(
        new Request("https://example.test/api/schedule/refresh", {
          headers: { authorization: `Bearer ${secret}` },
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await handlers.POST(
        new Request("https://example.test/api/schedule/refresh", {
          method: "POST",
          headers: {
            authorization: `Bearer ${cronSecret}`,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(401);
  expect(calls).toEqual([
    { sha: undefined },
    { sha: "0123456789abcdef0123456789abcdef01234567" },
  ]);
});

test("Schedule refresh rejects unauthenticated requests and maps busy state", async () => {
  process.env.CRON_SECRET = secret;
  const { createScheduleRefreshHandlers } = await import(
    "@/app/api/schedule/refresh/route"
  );
  const handlers = createScheduleRefreshHandlers(async () => ({
    status: "busy" as const,
  }));

  const unauthorized = await handlers.GET(
    new Request("https://example.test/api/schedule/refresh"),
  );
  const busy = await handlers.GET(
    new Request("https://example.test/api/schedule/refresh", {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );

  expect(unauthorized.status).toBe(401);
  expect(busy.status).toBe(409);
});

test("public Schedule health is bounded and independent", async () => {
  const { createScheduleHealthHandler } = await import(
    "@/app/api/health/schedule/route"
  );
  const GET = createScheduleHealthHandler(async () => ({
    status: "stale" as const,
    activeGeneration: "0123456789abcdef0123456789abcdef01234567",
    acceptedAt: "2026-08-20T06:00:00.000Z",
    sourceUpdatedAt: "2026-08-20T05:55:27.000Z",
    failureClass: "upstream" as const,
    failureAt: "2026-08-21T06:00:00.000Z",
  }));

  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({
    status: "stale",
    activeGeneration: "0123456789abcdef0123456789abcdef01234567",
    acceptedAt: "2026-08-20T06:00:00.000Z",
    sourceUpdatedAt: "2026-08-20T05:55:27.000Z",
    failureClass: "upstream",
    failureAt: "2026-08-21T06:00:00.000Z",
  });
  expect(JSON.stringify(body)).not.toContain("credential");
  expect(JSON.stringify(body)).not.toContain("rankings");
});

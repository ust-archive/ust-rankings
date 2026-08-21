import { afterEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const secret = "correct-secret-with-enough-entropy";

afterEach(() => {
  delete process.env.RANKINGS_REFRESH_SECRET;
  delete process.env.CRON_SECRET;
});

test("authenticated publication and cron requests invoke the same refresh operation", async () => {
  process.env.RANKINGS_REFRESH_SECRET = secret;
  const calls: Array<{ sha?: string }> = [];
  const operation = vi.fn(async (options: { sha?: string }) => {
    calls.push(options);
    return {
      status: "activated" as const,
      generation: options.sha ?? "latest",
    };
  });
  const { createRankingRefreshHandlers } = await import(
    "@/app/api/rankings/refresh/route"
  );
  const handlers = createRankingRefreshHandlers(operation);
  const authorization = { authorization: `Bearer ${secret}` };

  const cron = await handlers.GET(
    new Request("https://example.test/api/rankings/refresh", {
      headers: authorization,
    }),
  );
  const publication = await handlers.POST(
    new Request("https://example.test/api/rankings/refresh", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        sha: "0123456789abcdef0123456789abcdef01234567",
      }),
    }),
  );

  expect(cron.status).toBe(200);
  expect(publication.status).toBe(200);
  expect(calls).toEqual([
    { sha: undefined },
    { sha: "0123456789abcdef0123456789abcdef01234567" },
  ]);
});

test("refresh route maps distributed exclusion and bounded failures", async () => {
  process.env.CRON_SECRET = secret;
  const { createRankingRefreshHandlers } = await import(
    "@/app/api/rankings/refresh/route"
  );
  const request = new Request("https://example.test/api/rankings/refresh", {
    headers: { authorization: `Bearer ${secret}` },
  });
  const busy = createRankingRefreshHandlers(async () => ({
    status: "busy" as const,
  }));
  const failed = createRankingRefreshHandlers(async () => {
    const { RankingsRefreshError } = await import("@/lib/rankings/server");
    throw new RankingsRefreshError("integrity");
  });

  expect((await busy.GET(request.clone())).status).toBe(409);
  const failure = await failed.GET(request.clone());
  expect(failure.status).toBe(503);
  expect(await failure.json()).toEqual({
    error: "Rankings refresh failed; last-known-good remains active.",
    failureClass: "integrity",
  });
});

test("public ranking health is bounded and non-sensitive", async () => {
  const { createRankingHealthHandler } = await import(
    "@/app/api/health/rankings/route"
  );
  const GET = createRankingHealthHandler(async () => ({
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
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  expect(body).toEqual({
    status: "stale",
    activeGeneration: "0123456789abcdef0123456789abcdef01234567",
    acceptedAt: "2026-08-20T06:00:00.000Z",
    sourceUpdatedAt: "2026-08-20T05:55:27.000Z",
    failureClass: "upstream",
    failureAt: "2026-08-21T06:00:00.000Z",
  });
  expect(JSON.stringify(body)).not.toContain("credential");
  expect(JSON.stringify(body)).not.toContain("generations/");
  expect(JSON.stringify(body)).not.toContain("email");
  expect(JSON.stringify(body)).not.toContain("session");
});

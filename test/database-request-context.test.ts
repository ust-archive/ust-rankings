import { afterEach, expect, it, vi } from "vitest";
import { databaseRequestContext } from "@/lib/database-request-context";

const requestHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: requestHeaders }));
afterEach(() => vi.resetAllMocks());

it("attributes declared crawlers without retaining arbitrary headers", async () => {
  requestHeaders.mockResolvedValue(
    new Headers({
      "user-agent":
        "Mozilla/5.0 (compatible; Googlebot/2.1; +https://private.example/token)",
      referer: "https://private.example/user?token=secret",
      cookie: "session=secret",
    }),
  );
  const context = await databaseRequestContext({
    caller: "course",
    authentication: "anonymous",
  });
  expect(context).toEqual({
    caller: "course",
    authentication: "anonymous",
    requestClass: "unknown",
    agentClass: "declared-bot",
    previousAgentClass: "declared-bot",
    fetchSite: "missing",
  });
  expect(JSON.stringify(context)).not.toMatch(
    /private|secret|Mozilla|Googlebot/,
  );
});

it.each(["GPTBot/1.0", "ClaudeBot/1.0", "meta-externalagent/1.1"])(
  "recognizes the declared crawler %s",
  async (agent) => {
    requestHeaders.mockResolvedValue(new Headers({ "user-agent": agent }));
    expect(
      await databaseRequestContext({ caller: "instructor" }),
    ).toMatchObject({ agentClass: "declared-bot" });
  },
);

it("separates browser-like navigation from explicit prefetch", async () => {
  requestHeaders.mockResolvedValue(
    new Headers({
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "sec-fetch-site": "same-origin",
      "sec-fetch-dest": "document",
    }),
  );
  expect(await databaseRequestContext({ caller: "course" })).toMatchObject({
    agentClass: "browser-like",
    fetchSite: "same-origin",
    requestClass: "document",
  });
  requestHeaders.mockResolvedValue(
    new Headers({ purpose: "prefetch", "sec-fetch-site": "arbitrary-secret" }),
  );
  expect(await databaseRequestContext({ caller: "course" })).toMatchObject({
    agentClass: "missing",
    fetchSite: "unknown",
    requestClass: "explicit-prefetch",
  });
});

it("recognizes additional automated clients and keeps unavailable context distinct", async () => {
  requestHeaders.mockResolvedValue(new Headers({ "user-agent": "curl/8.0" }));
  expect(await databaseRequestContext({ caller: "course" })).toMatchObject({
    agentClass: "declared-bot",
    previousAgentClass: "other",
    fetchSite: "missing",
  });
  requestHeaders.mockRejectedValue(new Error("outside request"));
  expect(
    await databaseRequestContext({
      caller: "operator",
      requestClass: "non-http",
    }),
  ).toMatchObject({ agentClass: "unknown", fetchSite: "unknown" });
});

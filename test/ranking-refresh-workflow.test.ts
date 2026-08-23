import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const script = resolve("scripts/refresh-rankings-runtime.ts");
const sha = "0123456789abcdef0123456789abcdef01234567";
let server: Server;
let origin: string;
let triggerStatus: number;
let healthChecks: number;
let activeGeneration: string;
let holdTriggerHeaders: boolean;
let holdTriggerBody: boolean;
let holdHealthBody: boolean;

beforeEach(async () => {
  triggerStatus = 504;
  healthChecks = 0;
  activeGeneration = sha;
  holdTriggerHeaders = false;
  holdTriggerBody = false;
  holdHealthBody = false;
  server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/rankings/refresh") {
      if (holdTriggerHeaders) return;
      response.writeHead(triggerStatus);
      if (holdTriggerBody) response.flushHeaders();
      else response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/api/health/rankings") {
      healthChecks++;
      response.writeHead(200, { "content-type": "application/json" });
      if (holdHealthBody) response.flushHeaders();
      else response.end(JSON.stringify({ activeGeneration }));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  server.close();
  server.closeAllConnections();
  await once(server, "close");
});

function runRefresh(timeoutMs?: number) {
  return execFileAsync(process.execPath, [script, sha], {
    env: {
      ...process.env,
      RANKINGS_REFRESH_SECRET: "test-secret-with-at-least-32-characters",
      RANKINGS_REFRESH_TIMEOUT_MS: timeoutMs?.toString(),
      RANKINGS_REFRESH_URL: origin,
    },
  });
}

test.each([200, 409, 502, 503, 504])(
  "HTTP %i passes after health confirms the published generation",
  async (status) => {
    triggerStatus = status;
    await expect(runRefresh()).resolves.toMatchObject({
      stdout: expect.stringContaining(`Ranking generation ${sha} is active.`),
    });
    expect(healthChecks).toBe(1);
  },
);

test("an authentication failure does not wait for its response body", async () => {
  triggerStatus = 401;
  holdTriggerBody = true;
  await expect(runRefresh()).rejects.toMatchObject({
    stderr: expect.stringContaining("Ranking refresh returned HTTP 401"),
  });
  expect(healthChecks).toBe(0);
});

test("a trigger that never returns headers expires at the workflow deadline", async () => {
  holdTriggerHeaders = true;
  await expect(runRefresh(2_000)).rejects.toMatchObject({
    stderr: expect.stringContaining(
      `Ranking generation ${sha} did not become active`,
    ),
  });
  expect(healthChecks).toBe(0);
});

test("a different active generation expires at the workflow deadline", async () => {
  activeGeneration = "f".repeat(40);
  await expect(runRefresh(2_000)).rejects.toMatchObject({
    stderr: expect.stringContaining(
      `Ranking generation ${sha} did not become active`,
    ),
  });
  expect(healthChecks).toBeGreaterThan(0);
});

test("a hanging health response expires at the workflow deadline", async () => {
  holdHealthBody = true;
  await expect(runRefresh(2_000)).rejects.toMatchObject({
    stderr: expect.stringContaining(
      `Ranking generation ${sha} did not become active`,
    ),
  });
  expect(healthChecks).toBe(1);
});

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

beforeEach(async () => {
  triggerStatus = 504;
  healthChecks = 0;
  server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/rankings/refresh") {
      response.writeHead(triggerStatus).end();
      return;
    }
    if (request.method === "GET" && request.url === "/api/health/rankings") {
      healthChecks++;
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ activeGeneration: sha }));
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
  await once(server, "close");
});

function runRefresh() {
  return execFileAsync(process.execPath, [script, sha], {
    env: {
      ...process.env,
      RANKINGS_REFRESH_SECRET: "test-secret-with-at-least-32-characters",
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

test("an authentication failure does not poll health", async () => {
  triggerStatus = 401;
  await expect(runRefresh()).rejects.toMatchObject({
    stderr: expect.stringContaining("Ranking refresh returned HTTP 401"),
  });
  expect(healthChecks).toBe(0);
});

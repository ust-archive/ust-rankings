import { setTimeout as sleep } from "node:timers/promises";

const maximumTimeoutMs = 5 * 60_000;
const configuredTimeoutMs = Number(
  process.env.RANKINGS_REFRESH_TIMEOUT_MS ?? maximumTimeoutMs,
);
const timeoutMs = Math.min(configuredTimeoutMs, maximumTimeoutMs);
const pollIntervalMs = Math.min(5_000, timeoutMs);
const acceptedTriggerStatuses = new Set([200, 409, 502, 503, 504]);
const sha = process.argv[2];
const baseUrl = process.env.RANKINGS_REFRESH_URL;
const secret = process.env.RANKINGS_REFRESH_SECRET;

if (!sha || !/^[0-9a-f]{40}$/.test(sha))
  throw new Error("A full ranking generation SHA is required.");
if (!baseUrl || !secret)
  throw new Error("Ranking refresh URL and secret are required.");
if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs <= 0)
  throw new Error("Ranking refresh timeout must be positive.");

const refreshUrl = new URL("/api/rankings/refresh", baseUrl);
const healthUrl = new URL("/api/health/rankings", baseUrl);
let triggerStatus: number | undefined;
const deadline = Date.now() + timeoutMs;
const deadlineSignal = () => {
  const remainingMs = deadline - Date.now();
  return remainingMs > 0
    ? AbortSignal.timeout(remainingMs)
    : AbortSignal.abort();
};

try {
  const response = await fetch(refreshUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sha }),
    signal: deadlineSignal(),
  });
  triggerStatus = response.status;
  void response.body?.cancel().catch(() => {});
} catch {
  console.warn("Ranking refresh request ended before confirmation.");
}

if (triggerStatus !== undefined && !acceptedTriggerStatuses.has(triggerStatus))
  throw new Error(`Ranking refresh returned HTTP ${triggerStatus}.`);
if (triggerStatus !== undefined)
  console.log(
    `Ranking refresh returned HTTP ${triggerStatus}; checking health.`,
  );
let active = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: deadlineSignal(),
    });
    if (response.ok) {
      const health: unknown = await response.json();
      if (
        health &&
        typeof health === "object" &&
        "activeGeneration" in health &&
        health.activeGeneration === sha
      ) {
        active = true;
        break;
      }
    }
  } catch {
    // Health can be briefly unavailable while a deployment changes over.
  }
  const remainingMs = deadline - Date.now();
  if (remainingMs > 0) await sleep(Math.min(pollIntervalMs, remainingMs));
}

if (!active)
  throw new Error(
    `Ranking generation ${sha} did not become active before the refresh deadline.`,
  );
console.log(`Ranking generation ${sha} is active.`);

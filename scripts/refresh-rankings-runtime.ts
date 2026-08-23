import { setTimeout as sleep } from "node:timers/promises";

const pollIntervalMs = 5_000;
const timeoutMs = 5 * 60_000;
const acceptedTriggerStatuses = new Set([200, 409, 502, 503, 504]);
const sha = process.argv[2];
const baseUrl = process.env.RANKINGS_REFRESH_URL;
const secret = process.env.RANKINGS_REFRESH_SECRET;

if (!sha || !/^[0-9a-f]{40}$/.test(sha))
  throw new Error("A full ranking generation SHA is required.");
if (!baseUrl || !secret)
  throw new Error("Ranking refresh URL and secret are required.");

const refreshUrl = new URL("/api/rankings/refresh", baseUrl);
const healthUrl = new URL("/api/health/rankings", baseUrl);
let triggerStatus: number | undefined;

try {
  const response = await fetch(refreshUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sha }),
  });
  triggerStatus = response.status;
  await response.arrayBuffer();
} catch {
  console.warn("Ranking refresh request ended before confirmation.");
}

if (triggerStatus !== undefined && !acceptedTriggerStatuses.has(triggerStatus))
  throw new Error(`Ranking refresh returned HTTP ${triggerStatus}.`);
if (triggerStatus !== undefined)
  console.log(
    `Ranking refresh returned HTTP ${triggerStatus}; checking health.`,
  );

const deadline = Date.now() + timeoutMs;
let active = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, { cache: "no-store" });
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
  await sleep(pollIntervalMs);
}

if (!active)
  throw new Error(
    `Ranking generation ${sha} did not become active in 5 minutes.`,
  );
console.log(`Ranking generation ${sha} is active.`);

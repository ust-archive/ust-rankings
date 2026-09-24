import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

type Window = { from: string; to: string };
type Event = {
  operationId: string;
  processId: string;
  deployment: string;
  timestamp: string;
  operation: string;
  caller: string;
  intent: string;
  authentication: string;
  requestClass: string;
  phase: "attempt" | "complete";
  outcome?: "success" | "error";
  errorCategory?: string;
  durationMs?: number;
};
function windowTimes(window: Window) {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
    throw new Error(
      "Provide a valid increasing --from/--to UTC capture interval",
    );
  return { from, to };
}

/** Reads JSON lines, including DigitalOcean's optional timestamp/component prefix. */
export async function summarizeDatabaseLogs(
  lines: Iterable<string> | AsyncIterable<string>,
  window: Window,
) {
  const { from, to } = windowTimes(window);
  const counts = {
    attempts: 0,
    completions: 0,
    successes: 0,
    errors: 0,
    duplicates: 0,
    malformed: 0,
    unsupported: 0,
    outsideWindow: 0,
    unmatchedAttempts: 0,
    unmatchedCompletions: 0,
  };
  const events = new Map<string, Event>();
  for await (const line of lines) {
    if (!line.includes('"database-operation"')) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line.slice(line.indexOf("{")));
    } catch {
      counts.malformed++;
      continue;
    }
    if (value?.event !== "database-operation") continue;
    if (value.version !== 1) {
      counts.unsupported++;
      continue;
    }
    if (
      [
        "operationId",
        "processId",
        "deployment",
        "timestamp",
        "operation",
        "caller",
        "intent",
        "authentication",
        "requestClass",
      ].some((key) => typeof value[key] !== "string") ||
      !["attempt", "complete"].includes(String(value.phase)) ||
      !Number.isFinite(Date.parse(String(value.timestamp))) ||
      (value.phase === "complete" &&
        (!["success", "error"].includes(String(value.outcome)) ||
          typeof value.durationMs !== "number" ||
          !Number.isFinite(value.durationMs) ||
          value.durationMs < 0))
    ) {
      counts.malformed++;
      continue;
    }
    const time = Date.parse(String(value.timestamp));
    if (time < from || time >= to) {
      counts.outsideWindow++;
      continue;
    }
    const event = value as unknown as Event;
    const key = `${event.processId}/${event.operationId}/${event.phase}`;
    if (events.has(key)) {
      counts.duplicates++;
      continue;
    }
    events.set(key, event);
  }
  const groups = new Map<
    string,
    {
      deployment: string;
      operation: string;
      caller: string;
      intent: string;
      authentication: string;
      requestClass: string;
      attempts: number;
      completions: number;
      errors: number;
      totalDurationMs: number;
    }
  >();
  const buckets = new Map<
    string,
    { minute: string; attempts: number; completions: number; errors: number }
  >();
  const errorCategories: Record<string, number> = Object.create(null);
  const attemptTimes: number[] = [];
  for (const event of events.values()) {
    const {
      deployment,
      operation,
      caller,
      intent,
      authentication,
      requestClass,
    } = event;
    const dimensions = {
      deployment,
      operation,
      caller,
      intent,
      authentication,
      requestClass,
    };
    const key = JSON.stringify(dimensions);
    const group = groups.get(key) ?? {
      ...dimensions,
      attempts: 0,
      completions: 0,
      errors: 0,
      totalDurationMs: 0,
    };
    groups.set(key, group);
    const minute = new Date(event.timestamp).toISOString().slice(0, 16);
    const bucket = buckets.get(minute) ?? {
      minute,
      attempts: 0,
      completions: 0,
      errors: 0,
    };
    buckets.set(minute, bucket);
    const counterpart = `${event.processId}/${event.operationId}/${event.phase === "attempt" ? "complete" : "attempt"}`;
    if (event.phase === "attempt") {
      counts.attempts++;
      group.attempts++;
      bucket.attempts++;
      attemptTimes.push(Date.parse(event.timestamp));
      if (!events.has(counterpart)) counts.unmatchedAttempts++;
    } else {
      counts.completions++;
      group.completions++;
      bucket.completions++;
      group.totalDurationMs += event.durationMs ?? 0;
      if (!events.has(counterpart)) counts.unmatchedCompletions++;
      if (event.outcome === "error") {
        counts.errors++;
        group.errors++;
        bucket.errors++;
        const category = event.errorCategory ?? "other";
        errorCategories[category] = (errorCategories[category] ?? 0) + 1;
      } else counts.successes++;
    }
  }
  attemptTimes.sort((a, b) => a - b);
  let gap = 0;
  for (let index = 1; index < attemptTimes.length; index++)
    gap = Math.max(gap, attemptTimes[index] - attemptTimes[index - 1]);
  return {
    window,
    counts,
    coverage:
      "Counts describe captured events only. Missing events and observed gaps are not proof of database inactivity; include all instances and operator logs, and record known capture gaps separately.",
    firstAttempt: attemptTimes.length
      ? new Date(attemptTimes[0]).toISOString()
      : null,
    lastAttempt: attemptTimes.length
      ? new Date(attemptTimes.at(-1) as number).toISOString()
      : null,
    largestObservedAttemptGapSeconds:
      attemptTimes.length > 1 ? gap / 1000 : null,
    groups: [...groups.values()].sort((a, b) => b.attempts - a.attempts),
    minutes: [...buckets.values()].sort((a, b) =>
      a.minute.localeCompare(b.minute),
    ),
    errorCategories,
  };
}

type Usage = {
  timestamp: string;
  scope: string;
  compute_time_seconds: number;
  active_time_seconds: number;
};
export function compareUsage(before: Usage, after: Usage, window: Window) {
  const { from, to } = windowTimes(window);
  if (
    !before ||
    !after ||
    typeof before.scope !== "string" ||
    !before.scope ||
    before.scope !== after.scope ||
    Date.parse(before.timestamp) !== from ||
    Date.parse(after.timestamp) !== to ||
    [
      before.compute_time_seconds,
      after.compute_time_seconds,
      before.active_time_seconds,
      after.active_time_seconds,
    ].some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) || value < 0,
    ) ||
    after.compute_time_seconds < before.compute_time_seconds ||
    after.active_time_seconds < before.active_time_seconds
  )
    throw new Error(
      "Usage snapshots must match the capture boundaries, project/branch/billing period, and increasing counters",
    );
  return {
    computeHours:
      (after.compute_time_seconds - before.compute_time_seconds) / 3600,
    activeHours:
      (after.active_time_seconds - before.active_time_seconds) / 3600,
    scope: before.scope,
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string" },
      to: { type: "string" },
      "usage-before": { type: "string" },
      "usage-after": { type: "string" },
    },
  });
  if (
    !values.from ||
    !values.to ||
    !positionals.length ||
    Boolean(values["usage-before"]) !== Boolean(values["usage-after"])
  )
    throw new Error(
      "Usage: node scripts/summarize-database-logs.ts --from <UTC> --to <UTC> [--usage-before before.json --usage-after after.json] <runtime.log> [...logs]",
    );
  async function* lines() {
    for (const path of positionals) {
      const input = createReadStream(path, { encoding: "utf8" });
      const reader = createInterface({ input, crlfDelay: Infinity });
      try {
        yield* reader;
      } finally {
        reader.close();
        input.destroy();
      }
    }
  }
  const window = { from: values.from, to: values.to };
  const report = await summarizeDatabaseLogs(lines(), window);
  const usage =
    values["usage-before"] && values["usage-after"]
      ? compareUsage(
          JSON.parse(await readFile(values["usage-before"], "utf8")),
          JSON.parse(await readFile(values["usage-after"], "utf8")),
          window,
        )
      : undefined;
  console.log(JSON.stringify({ ...report, usage }, null, 2));
}

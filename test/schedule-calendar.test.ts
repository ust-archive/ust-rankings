import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  makeScheduleGeneration,
  type ScheduleFixtureVariant,
} from "./schedule-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function configureFixture(
  sourceCommit?: string,
  variant?: ScheduleFixtureVariant,
) {
  const root = await mkdtemp(join(tmpdir(), "schedule-calendar-"));
  temporaryDirectories.push(root);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(
    root,
    variant,
    sourceCommit,
  );
}

function eventUidsByStart(body: string) {
  return Object.fromEntries(
    body
      .split("BEGIN:VEVENT")
      .slice(1)
      .map((event) => {
        const start = event.match(/DTSTART:(\d{8}T\d{6}Z)/)?.[1];
        const uid = event.match(/UID:([^\r\n]+)/)?.[1];
        if (!start || !uid) throw new Error("Invalid calendar test event");
        return [start, uid];
      }),
  );
}

afterEach(async () => {
  delete process.env.SCHEDULE_SEED_DIR;
  const { resetScheduleRuntimeForTests } = await import(
    "@/lib/schedule/server"
  );
  await resetScheduleRuntimeForTests();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("canonical calendar rejects missing required parameters", async () => {
  await configureFixture();
  const { GET } = await import("@/app/schedule/calendar.ics/route");

  for (const url of [
    "https://example.test/schedule/calendar.ics",
    "https://example.test/schedule/calendar.ics?term=2510",
    "https://example.test/schedule/calendar.ics?class=1001",
    "https://example.test/schedule/calendar.ics?term=2510&term=2510&class=1001",
  ]) {
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Term Code");
  }
});

test("canonical calendar is strict, normalized, stable, zoned, and cacheable for signed-out requests", async () => {
  await configureFixture();
  const { GET } = await import("@/app/schedule/calendar.ics/route");
  const url =
    "https://example.test/schedule/calendar.ics?term=2510&class=1001&class=1001";

  const first = await GET(new Request(url));
  const body = await first.text();
  const second = await GET(new Request(url));
  const etag = first.headers.get("etag");

  expect(first.status).toBe(200);
  expect(first.headers.get("content-type")).toBe(
    "text/calendar; charset=utf-8",
  );
  expect(first.headers.get("content-disposition")).toBeNull();
  expect(first.headers.get("content-location")).toBe(
    "/schedule/calendar.ics?term=2510&class=1001",
  );
  expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(body).toMatch(/UID:2510-1001-[0-9a-f]{24}@ust-rankings/);
  expect(body).toContain("DTSTAMP:19700101T000000Z");
  expect(body).toContain("DTSTART:20250903T030000Z");
  expect(body).toContain("DTEND:20250903T035000Z");
  expect(body).toContain("UNTIL=20251130T035000Z");
  expect(await second.text()).toBe(body);

  for (const validator of [etag ?? "", `W/${etag}`]) {
    const notModified = await GET(
      new Request(url, { headers: { "if-none-match": validator } }),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
  }
});

test("one invalid Class rejects the complete canonical calendar", async () => {
  await configureFixture();
  const { GET } = await import("@/app/schedule/calendar.ics/route");
  const unknownTerm = await GET(
    new Request(
      "https://example.test/schedule/calendar.ics?term=9999&class=1001",
    ),
  );
  expect(unknownTerm.status).toBe(400);
  expect(await unknownTerm.text()).toBe("Unknown Term Code.");

  const response = await GET(
    new Request(
      "https://example.test/schedule/calendar.ics?term=2510&class=1001&class=9999",
    ),
  );

  expect(response.status).toBe(404);
  expect(await response.text()).toBe("Unknown Class Number.");
});

test("download is explicit and webcal uses the canonical query unchanged", async () => {
  await configureFixture();
  const { GET } = await import("@/app/schedule/calendar.ics/route");
  const query = "term=2510&class=1001";
  const inline = await GET(
    new Request(`webcal://example.test/schedule/calendar.ics?${query}`),
  );
  const download = await GET(
    new Request(
      `https://example.test/schedule/calendar.ics?${query}&download=1`,
    ),
  );

  expect(inline.status).toBe(200);
  expect(inline.headers.get("content-disposition")).toBeNull();
  expect(download.headers.get("content-disposition")).toBe(
    'attachment; filename="ust-schedule.ics"',
  );
  expect(await download.text()).toBe(await inline.text());
});

test("legacy subscribers invoke the strict canonical generator", async () => {
  await configureFixture();
  const { GET: canonicalGET } = await import(
    "@/app/schedule/calendar.ics/route"
  );
  const { GET: legacyGET } = await import("@/app/api/calendar/route");
  const canonical = await canonicalGET(
    new Request(
      "https://example.test/schedule/calendar.ics?term=2510&class=1001",
    ),
  );
  const legacy = await legacyGET(
    new Request(
      "https://example.test/api/calendar?term=2510&number=1001&webcal=1",
    ),
  );

  expect(legacy.status).toBe(200);
  expect(legacy.headers.get("content-disposition")).toBeNull();
  expect(await legacy.text()).toBe(await canonical.text());

  const invalid = await legacyGET(
    new Request(
      "https://example.test/api/calendar?term=2510&number=1001&number=9999",
    ),
  );
  expect(invalid.status).toBe(404);
});

test("calendar ETag identifies the body and accepted Schedule generation", async () => {
  const { GET } = await import("@/app/schedule/calendar.ics/route");
  const request = () =>
    new Request(
      "https://example.test/schedule/calendar.ics?term=2510&class=1001",
    );
  await configureFixture(undefined, "calendar-base");
  const first = await GET(request());

  await configureFixture(undefined, "calendar-updated");
  const changedBody = await GET(request());
  expect(await first.clone().text()).not.toBe(await changedBody.clone().text());
  expect(first.headers.get("etag")).not.toBe(changedBody.headers.get("etag"));

  await configureFixture(
    "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "calendar-updated",
  );
  const changedGeneration = await GET(request());
  expect(await changedBody.clone().text()).toBe(
    await changedGeneration.clone().text(),
  );
  expect(changedBody.headers.get("etag")).not.toBe(
    changedGeneration.headers.get("etag"),
  );
});

test("meeting UIDs survive reorder, insertion, and descriptive updates", async () => {
  const { GET } = await import("@/app/schedule/calendar.ics/route");
  const request = () =>
    new Request(
      "https://example.test/schedule/calendar.ics?term=2510&class=1001",
    );

  await configureFixture(undefined, "calendar-base");
  const base = eventUidsByStart(await (await GET(request())).text());
  await configureFixture(undefined, "calendar-reordered");
  const reordered = eventUidsByStart(await (await GET(request())).text());
  await configureFixture(undefined, "calendar-inserted");
  const inserted = eventUidsByStart(await (await GET(request())).text());
  await configureFixture(undefined, "calendar-updated");
  const updated = eventUidsByStart(await (await GET(request())).text());

  expect(reordered).toEqual(base);
  expect(inserted["20250903T030000Z"]).toBe(base["20250903T030000Z"]);
  expect(inserted["20250903T070000Z"]).toBe(base["20250903T070000Z"]);
  expect(inserted["20250903T050000Z"]).toBeDefined();
  expect(updated).toEqual(base);
});

test("malformed source meeting data fails internally without blaming the request", async () => {
  await configureFixture(undefined, "invalid-meeting");
  const { GET } = await import("@/app/schedule/calendar.ics/route");
  const errorLog = spyOn(console, "error").mockImplementation(() => {});
  const response = await GET(
    new Request(
      "https://example.test/schedule/calendar.ics?term=2510&class=1001",
    ),
  );

  expect(response.status).toBe(500);
  expect(await response.text()).toBe("Calendar generation failed.");
  expect(errorLog).toHaveBeenCalled();
  errorLog.mockRestore();
});

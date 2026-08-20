import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { makeScheduleGeneration } from "./schedule-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

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

test("the public Schedule route renders Term selection and dense searchable Classes", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-route-"));
  temporaryDirectories.push(root);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(root);
  const { default: SchedulePage } = await import("@/app/schedule/page");

  const markup = renderToStaticMarkup(
    await SchedulePage({
      searchParams: Promise.resolve({ term: "2510", q: "Room 101" }),
    }),
  );

  expect(markup).toContain("UST Schedule");
  expect(markup).toContain('name="term"');
  expect(markup).toContain('name="q"');
  expect(markup).toContain("2025-26 Fall");
  expect(markup).toContain("COMP 2000");
  expect(markup).toContain("Updated Course title");
  expect(markup).toContain("L1");
  expect(markup).toContain("1001");
  expect(markup).toContain("Alpha Instructor");
  expect(markup).toContain("Room 101");
  expect(markup).not.toContain("MATH 1000");

  const missingDates = renderToStaticMarkup(
    await SchedulePage({
      searchParams: Promise.resolve({ term: "2510", q: "Room 202" }),
    }),
  );
  expect(missingDates).toContain("Dates TBA");
  expect(missingDates).not.toContain(">–</span>");
});

test("Schedule query errors and unavailable data have accessible specific states", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-states-"));
  temporaryDirectories.push(root);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(root);
  const { default: SchedulePage } = await import("@/app/schedule/page");

  const invalid = renderToStaticMarkup(
    await SchedulePage({
      searchParams: Promise.resolve({ term: "bad", q: "x".repeat(101) }),
    }),
  );
  expect(invalid).toContain("Invalid Schedule query");
  expect(invalid).toContain('role="alert"');

  process.env.SCHEDULE_SEED_DIR = join(root, "missing");
  const unavailable = renderToStaticMarkup(
    await SchedulePage({ searchParams: Promise.resolve({}) }),
  );
  expect(unavailable).toContain("UST Schedule is unavailable");
  expect(unavailable).toContain('role="alert"');
});

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
  expect(markup).toContain('name="view"');
  expect(markup).toContain("Browse Classes");
  expect(markup).toContain("Planner cart");
  expect(markup).toContain("Add Class 1001");
  expect(markup).toContain("Class details:");
  expect(markup).toContain(
    'href="/courses/COMP/2000/2510">COMP 2000 · Updated Course title',
  );
  expect(markup).toContain('href="/courses/COMP/2000/2510/L1">L1 · 1001');
  expect(markup).toContain("Import from SIS");
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

test("shareable planner state renders selected Classes and safe inline validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-planner-route-"));
  temporaryDirectories.push(root);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(root);
  const { default: SchedulePage } = await import("@/app/schedule/page");

  const selected = renderToStaticMarkup(
    await SchedulePage({
      searchParams: Promise.resolve({
        term: "2510",
        q: "Room",
        class: ["2001", "1001", "1001"],
        view: "cart",
      }),
    }),
  );
  expect(selected).toContain("2 selected Classes");
  expect(selected).toContain("Remove Class 1001");
  expect(selected).toContain(
    "/schedule?term=2510&amp;q=Room&amp;class=2001&amp;view=cart",
  );
  expect(selected).toContain("Subscribe to selected Classes");
  expect(selected).toContain(
    "/schedule/calendar.ics?term=2510&amp;class=1001&amp;class=2001",
  );
  expect(selected).toContain(
    "/schedule/calendar.ics?term=2510&amp;class=1001&amp;class=2001&amp;download=1",
  );

  const invalid = renderToStaticMarkup(
    await SchedulePage({
      searchParams: Promise.resolve({
        term: "9999",
        class: ["1001", "9999"],
        view: "unsupported",
      }),
    }),
  );
  expect(invalid).toContain('role="alert"');
  expect(invalid).toContain("Unknown Term Code; showing the latest Term.");
  expect(invalid).toContain(
    "Selected Class Numbers are not available in this Term; the planner cart was reset.",
  );
  expect(invalid).toContain("Unknown Schedule view; showing Browse.");
  expect(invalid).toContain("0 selected Classes");

  for (const term of ["bad", ["2510", "2520"]]) {
    const malformedTerm = renderToStaticMarkup(
      await SchedulePage({
        searchParams: Promise.resolve({
          term,
          class: "1001",
          view: "cart",
        }),
      }),
    );
    expect(malformedTerm).toContain("0 selected Classes");
    expect(malformedTerm).toContain(
      "Selected Class Numbers are not available in this Term; the planner cart was reset.",
    );
    expect(malformedTerm).not.toContain("Remove Class 1001");
  }

  const conflictRoot = await mkdtemp(
    join(tmpdir(), "schedule-conflict-route-"),
  );
  temporaryDirectories.push(conflictRoot);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(
    conflictRoot,
    "conflict",
  );
  const conflict = renderToStaticMarkup(
    await SchedulePage({
      searchParams: Promise.resolve({
        term: "2510",
        class: ["1001", "2001"],
        view: "cart",
      }),
    }),
  );
  expect(conflict).toContain("Schedule conflict");
  expect(conflict).toContain(
    "Classes 1001 and 2001 have overlapping meeting times.",
  );
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
  expect(invalid).toContain("Some Schedule values were not used");
  expect(invalid).toContain("Invalid Term Code; showing the latest Term.");
  expect(invalid).toContain("Search is limited to 100 characters.");
  expect(invalid).toContain('role="alert"');

  process.env.SCHEDULE_SEED_DIR = join(root, "missing");
  const unavailable = renderToStaticMarkup(
    await SchedulePage({ searchParams: Promise.resolve({}) }),
  );
  expect(unavailable).toContain("UST Schedule is unavailable");
  expect(unavailable).toContain('role="alert"');
});

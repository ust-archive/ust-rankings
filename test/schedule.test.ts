import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { makeRankingGeneration } from "./rankings-fixture";
import { makeScheduleGeneration, scheduleFixtureSha } from "./schedule-fixture";

vi.mock("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function configureFixture(
  malformation?: "duplicate-event" | "orphan-class",
) {
  const root = await mkdtemp(join(tmpdir(), "schedule-generation-"));
  const rankingRoot = await mkdtemp(join(tmpdir(), "ranking-for-schedule-"));
  temporaryDirectories.push(root, rankingRoot);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(
    root,
    malformation,
  );
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(rankingRoot);
}

afterEach(async () => {
  delete process.env.SCHEDULE_SEED_DIR;
  delete process.env.RANKINGS_SEED_DIR;
  const { resetScheduleRuntimeForTests } = await import(
    "@/lib/schedule/server"
  );
  const { resetRankingsRuntimeForTests } = await import(
    "@/lib/rankings/server"
  );
  await resetScheduleRuntimeForTests();
  await resetRankingsRuntimeForTests();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("an explicit SCHEDULE_SEED_DIR generation is accepted before it is served", async () => {
  process.env.SCHEDULE_SEED_DIR = join(
    process.cwd(),
    "schedule",
    "seed",
    "0ddb2e493caeeb8aa9c56728496c866c358a2431",
  );
  const { querySchedule } = await import("@/lib/schedule/server");
  const page = await querySchedule({ limit: 1 });

  expect(page.generation).toBe("0ddb2e493caeeb8aa9c56728496c866c358a2431");
  expect(page.terms.length).toBeGreaterThan(0);
  expect(page.results).toHaveLength(1);
});

test("production Schedule stays unavailable until a Hugging Face generation is accepted", async () => {
  const {
    querySchedule,
    ScheduleUnavailableError,
    resetScheduleRuntimeForTests,
  } = await import("@/lib/schedule/server");
  await resetScheduleRuntimeForTests({
    upstream: {
      async download() {
        throw new Error("upstream unavailable");
      },
    },
    store: {
      async readPointer() {
        return undefined;
      },
      async downloadGeneration() {
        return undefined;
      },
      async putGeneration() {},
      async writePointer() {},
      async readFailure() {
        return undefined;
      },
      async writeFailure() {},
    },
    async withLock(operation) {
      return operation();
    },
    async sleep() {},
  });

  await expect(querySchedule({ limit: 1 })).rejects.toBeInstanceOf(
    ScheduleUnavailableError,
  );
});

test("querySchedule reconstructs latest events before ACTIVE filtering", async () => {
  await configureFixture();
  const { querySchedule } = await import("@/lib/schedule/server");
  const page = await querySchedule({ termCode: "2510" });

  expect(page.generation).toBe(scheduleFixtureSha);
  expect(page.term).toEqual({
    termNumber: 100,
    termCode: "2510",
    termName: "2025-26 Fall",
  });
  expect(page.results.map((offering) => offering.courseCode)).toEqual([
    "COMP 2000",
    "MATH 1000",
  ]);
  expect(page.results[0]?.title).toBe("Updated Course title");
  expect(page.results[0]?.classes.map((item) => item.section)).toEqual(["L1"]);
  expect(page.results[0]?.classes[0]).toMatchObject({
    classNumber: 1001,
    section: "L1",
    remarks: "Bring a laptop",
    meetings: [
      {
        weekday: "Wed",
        dateFrom: "2025-09-01",
        dateTo: "2025-11-30",
        timeFrom: "11:00",
        timeTo: "11:50",
        room: "Room 101",
        roomCode: "R101",
        instructors: [
          {
            sourceName: "Alpha Instructor",
            uuid: "00000000-0000-4000-8000-000000000001",
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(page)).not.toContain("Old hidden Course");
  expect(JSON.stringify(page)).not.toContain('"section":"T1"');
});

test("unmatched Class source names stay unresolved and TBA is omitted", async () => {
  await configureFixture();
  const { querySchedule } = await import("@/lib/schedule/server");
  const page = await querySchedule({ termCode: "2510", search: "MATH 1000" });
  const instructors = page.results
    .flatMap((offering) => offering.classes)
    .flatMap((scheduleClass) => scheduleClass.meetings)
    .flatMap((meeting) => meeting.instructors);
  expect(instructors).toContainEqual({ sourceName: "Unresolved Teacher" });
  expect(instructors.some((instructor) => instructor.uuid)).toBe(false);
  expect(
    instructors.some(
      (instructor) => instructor.sourceName.toLocaleLowerCase() === "tba",
    ),
  ).toBe(false);
});

test("Schedule still serves when Rankings are unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-without-rankings-"));
  temporaryDirectories.push(root);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(root);
  const { querySchedule } = await import("@/lib/schedule/server");
  const page = await querySchedule({ termCode: "2510", search: "COMP 2000" });
  expect(page.results[0]?.courseCode).toBe("COMP 2000");
  expect(page.results[0]?.classes[0]?.meetings[0]?.instructors).toContainEqual({
    sourceName: "Alpha Instructor",
  });
});

test("bounded Schedule search covers Course, Instructor, room, Section, and Class Number", async () => {
  await configureFixture();
  const { InvalidScheduleQueryError, querySchedule } = await import(
    "@/lib/schedule/server"
  );

  for (const search of [
    "Updated Course",
    "Bounded search",
    "COMP 2000",
    "Alpha Instructor",
    "Room 101",
    "L1",
    "1001",
  ]) {
    const page = await querySchedule({ termCode: "2510", search });
    expect(page.results.map((offering) => offering.courseCode)).toContain(
      "COMP 2000",
    );
  }
  await expect(
    querySchedule({ termCode: "2510", search: "x".repeat(101) }),
  ).rejects.toBeInstanceOf(InvalidScheduleQueryError);
  await expect(querySchedule({ termCode: "unknown" })).rejects.toBeInstanceOf(
    InvalidScheduleQueryError,
  );
});

test("getSchedule and resolveClasses expose domain details without source mechanics", async () => {
  await configureFixture();
  const { getSchedule, resolveClasses } = await import("@/lib/schedule/server");

  const course = await getSchedule({
    type: "course",
    coursePrefix: "COMP",
    courseNumber: "2000",
  });
  expect(course).toMatchObject({
    type: "course",
    courseCode: "COMP 2000",
    offerings: [
      { termCode: "2430", classes: [{ classNumber: 3001 }] },
      { termCode: "2510", classes: [{ classNumber: 1001 }] },
    ],
  });

  const offering = await getSchedule({
    type: "course-offering",
    termCode: "2510",
    coursePrefix: "COMP",
    courseNumber: "2000",
  });
  expect(offering).toMatchObject({
    type: "course-offering",
    termCode: "2510",
    termName: "2025-26 Fall",
    courseCode: "COMP 2000",
    classes: [{ section: "L1", classNumber: 1001 }],
  });

  const classDetails = await getSchedule({
    type: "class",
    termCode: "2510",
    coursePrefix: "COMP",
    courseNumber: "2000",
    section: "l1",
  });
  expect(classDetails).toMatchObject({
    type: "class",
    courseCode: "COMP 2000",
    section: "L1",
    classNumber: 1001,
  });

  const classes = await resolveClasses("2510", [2001, 1001, 1001]);
  expect(classes.map((item) => item.classNumber)).toEqual([1001, 2001]);
  expect(classes[1]?.meetings[0]).toMatchObject({
    dateFrom: undefined,
    dateTo: undefined,
    instructors: [{ sourceName: "Unresolved Teacher" }],
  });
  await expect(resolveClasses("2510", [1001, 9999])).rejects.toThrow(
    "Unknown Class Number",
  );
});

test("duplicate event grains and broken Course/Class joins fail closed", async () => {
  const { querySchedule, ScheduleUnavailableError } = await import(
    "@/lib/schedule/server"
  );
  for (const malformation of ["duplicate-event", "orphan-class"] as const) {
    await configureFixture(malformation);
    await expect(querySchedule({ termCode: "2510" })).rejects.toBeInstanceOf(
      ScheduleUnavailableError,
    );
  }
});

test("missing or corrupted seed data fails only the Schedule module", async () => {
  await configureFixture();
  const directory = process.env.SCHEDULE_SEED_DIR;
  if (!directory) throw new Error("Schedule fixture was not configured");
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.artifacts["courses.parquet"].sha256 = "0".repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));

  const { querySchedule, ScheduleUnavailableError } = await import(
    "@/lib/schedule/server"
  );
  await expect(querySchedule({})).rejects.toBeInstanceOf(
    ScheduleUnavailableError,
  );
});

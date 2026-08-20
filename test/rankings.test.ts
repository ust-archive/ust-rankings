import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureSha, makeRankingGeneration } from "./rankings-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.RANKINGS_SEED_DIR;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("the shipped runtime seed is accepted before it is served", async () => {
  const { queryRankings } = await import("@/lib/rankings/server");
  const page = await queryRankings({
    entity: "instructor",
    preset: "learning",
    limit: 1,
  });

  expect(page.generation).toBe("0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d");
  expect(page.population.termCode).toBe("2610");
  expect(page.population.size).toBeGreaterThan(0);
  expect(page.results).toHaveLength(1);
});

test("queryRankings serves the Learning-focused Instructor Ranking Population", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "rankings-generation-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { getRankings, queryRankings } = await import("@/lib/rankings/server");
  const page = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    preset: "learning",
  });

  expect(page.generation).toBe(fixtureSha);
  expect(page.population).toEqual({
    entity: "instructor",
    termCode: "2510",
    activity: "current",
    size: 3,
    filteredSize: 3,
  });
  expect(
    page.results.map(({ canonicalName, globalRank, localRank }) => [
      canonicalName,
      globalRank,
      localRank,
    ]),
  ).toEqual([
    ["Alpha Instructor", 1, 1],
    ["Beta Instructor", 1, 1],
    ["Delta Instructor", 3, 3],
  ]);
  expect(page.configuration).toEqual({
    preset: "learning",
    weights: {
      content: 0.2667,
      teaching: 0.2667,
      grading: 0.1,
      workload: 0.0333,
      course: 0.0833,
      instructor: 0.25,
    },
  });
  expect(page.results[0]?.uuid).toBe("00000000-0000-4000-8000-000000000001");
  expect(page.results[0]?.score).toBe(1);
  expect(page.results[2]?.score).toBe(0.2667);
  expect(page.results[0]?.globalPercentile).toBe(1);
  expect(page.results[0]?.localPercentile).toBe(1);

  const searched = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    preset: "learning",
    search: "Second Teacher",
  });
  expect(searched.population.size).toBe(3);
  expect(
    searched.results.map(({ canonicalName, globalRank }) => [
      canonicalName,
      globalRank,
    ]),
  ).toEqual([["Beta Instructor", 1]]);

  const detail = await getRankings({
    type: "instructor",
    uuid: "00000000-0000-4000-8000-000000000002",
  });
  expect(detail.generation).toBe(fixtureSha);
  expect(detail.instructor.aliases[0]).toEqual({
    name: "Second Teacher",
    source: "sfq",
    sourceCommit: fixtureSha,
  });
  expect(detail.courses).toEqual([
    { termCode: "2510", courseCode: "MATH 2000" },
  ]);
  expect(detail.terms[0]?.criteria.instructor?.bayesian).toBe(1);
});

test("queryRankings serves Course presets and normalized custom weights", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "course-rankings-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { queryRankings } = await import("@/lib/rankings/server");
  const learning = await queryRankings({
    entity: "course",
    termCode: "2510",
    preset: "learning",
  });
  const grade = await queryRankings({
    entity: "course",
    termCode: "2510",
    preset: "grade",
  });
  const custom = await queryRankings({
    entity: "course",
    termCode: "2510",
    weights: { content: 2, teaching: 0 },
  });
  const instructorGrade = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    preset: "grade",
  });

  expect(learning.configuration.weights).toEqual({
    content: 0.2667,
    teaching: 0.2667,
    grading: 0.1,
    workload: 0.0333,
    course: 0.25,
    instructor: 0.0833,
  });
  expect(grade.configuration.weights).toEqual({
    content: 0.0667,
    teaching: 0.0667,
    grading: 0.4,
    workload: 0.1333,
    course: 0.25,
    instructor: 0.0833,
  });
  expect(
    learning.results.find((row) => row.courseCode === "COMP 1000")?.score,
  ).toBe(0.2667);
  expect(
    grade.results.find((row) => row.courseCode === "COMP 1000")?.score,
  ).toBe(0.0667);
  expect(instructorGrade.configuration.weights).toEqual({
    content: 0.0667,
    teaching: 0.0667,
    grading: 0.4,
    workload: 0.1333,
    course: 0.0833,
    instructor: 0.25,
  });
  expect(custom.configuration).toEqual({
    preset: "custom",
    weights: { content: 1 },
  });
  expect(custom.population.size).toBe(3);
  expect(
    custom.results.find((row) => row.courseCode === "COMP 1000")?.score,
  ).toBe(1);

  await expect(
    queryRankings({ entity: "course", weights: { content: -1 } }),
  ).rejects.toThrow("non-negative");
  await expect(
    queryRankings({ entity: "course", weights: { content: 0 } }),
  ).rejects.toThrow("non-zero");
});

test("structured filters create Local Ranks while search preserves both ranks", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ranking-filters-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { queryRankings } = await import("@/lib/rankings/server");
  const instructors = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    coursePrefix: "HIST",
    search: "History and Society",
  });
  expect(instructors.population).toMatchObject({ size: 3, filteredSize: 1 });
  expect(instructors.results).toEqual([
    expect.objectContaining({
      canonicalName: "Delta Instructor",
      globalRank: 3,
      globalPopulation: 3,
      localRank: 1,
      localPopulation: 1,
    }),
  ]);

  const courses = await queryRankings({
    entity: "course",
    termCode: "2510",
    commonCore: ["arts"],
    search: "Alpha Instructor",
  });
  expect(courses.population).toMatchObject({ size: 2, filteredSize: 1 });
  expect(courses.results).toEqual([
    expect.objectContaining({
      courseCode: "COMP 1000",
      title: "Creative Computing",
      localRank: 1,
    }),
  ]);

  const byItsc = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    search: "beta",
  });
  expect(byItsc.results.map((row) => row.canonicalName)).toEqual([
    "Beta Instructor",
  ]);
});

test("historical mode and generation-bound cursors remain reproducible", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ranking-cursors-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { queryRankings, StaleRankingsCursorError } = await import(
    "@/lib/rankings/server"
  );
  const current = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    limit: 1,
  });
  expect(current.results).toHaveLength(1);
  expect(current.nextCursor).toBeString();

  const next = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    limit: 1,
    cursor: current.nextCursor,
  });
  expect(next.results).toHaveLength(1);
  expect(next.results[0]?.uuid).not.toBe(current.results[0]?.uuid);
  await expect(
    queryRankings({
      entity: "instructor",
      termCode: "2510",
      search: "Alpha",
      limit: 1,
      cursor: current.nextCursor,
    }),
  ).rejects.toThrow("different ranking query");

  const historical = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    activity: "all",
    search: "Former Teacher",
  });
  expect(historical.results.map((row) => row.canonicalName)).toEqual([
    "Historical Instructor",
  ]);

  delete process.env.RANKINGS_SEED_DIR;
  await expect(
    queryRankings({
      entity: "instructor",
      termCode: "2510",
      limit: 1,
      cursor: current.nextCursor,
    }),
  ).rejects.toBeInstanceOf(StaleRankingsCursorError);
});

test("ranking pages stop at 100 rows and continue after the last position", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "ranking-page-size-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    temporaryDirectory,
    undefined,
    { extraInstructors: 101 },
  );

  const { queryRankings } = await import("@/lib/rankings/server");
  const first = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    limit: 500,
  });
  expect(first.results).toHaveLength(100);
  expect(first.nextCursor).toBeString();
  const second = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    limit: 100,
    cursor: first.nextCursor,
  });
  expect(second.results).toHaveLength(4);
  expect(second.nextCursor).toBeUndefined();
});

for (const [malformation, label] of [
  ["invalid-schema", "an incompatible schema"],
  ["duplicate-grain", "a duplicate documented grain"],
  ["null-samples", "missing sample evidence"],
  ["tba-alias", "a TBA Instructor Alias"],
] as const) {
  test(`queryRankings rejects ${label}`, async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), `rankings-${malformation}-`),
    );
    temporaryDirectories.push(temporaryDirectory);
    process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
      temporaryDirectory,
      malformation,
    );

    const { queryRankings, RankingsUnavailableError } = await import(
      "@/lib/rankings/server"
    );
    await expect(
      queryRankings({ entity: "instructor", preset: "learning" }),
    ).rejects.toBeInstanceOf(RankingsUnavailableError);
  });
}

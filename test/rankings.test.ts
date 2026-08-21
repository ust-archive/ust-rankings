import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { gradeColor } from "@/lib/rankings/presentation";
import { fixtureSha, makeRankingGeneration } from "./rankings-fixture";

vi.mock("server-only", () => ({}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.RANKINGS_SEED_DIR;
  delete process.env.RANKINGS_COURSE_CATALOG_FILE;
  const { resetRankingsRuntimeForTests } = await import(
    "@/lib/rankings/server"
  );
  await resetRankingsRuntimeForTests();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("the original bright grade palette is preserved", () => {
  expect(gradeColor(0)).toEqual([237, 27, 47]);
  expect(gradeColor(0.25)).toEqual([250, 166, 26]);
  expect(gradeColor(0.75)).toEqual([163, 207, 98]);
  expect(gradeColor(1)).toEqual([0, 154, 97]);
});

test("no valid generation fails only the ranking module", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "no-rankings-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR = join(temporaryDirectory, "missing");
  const { queryRankings, RankingsUnavailableError } = await import(
    "@/lib/rankings/server"
  );

  await expect(queryRankings({ entity: "instructor" })).rejects.toBeInstanceOf(
    RankingsUnavailableError,
  );
});

test("an explicit RANKINGS_SEED_DIR generation is accepted before it is served", async () => {
  process.env.RANKINGS_SEED_DIR = join(
    process.cwd(),
    "rankings",
    "seed",
    "0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d",
  );
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

test("production rankings stay unavailable until a Hugging Face generation is accepted", async () => {
  const {
    queryRankings,
    RankingsUnavailableError,
    resetRankingsRuntimeForTests,
  } = await import("@/lib/rankings/server");
  await resetRankingsRuntimeForTests({
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

  await expect(queryRankings({ entity: "instructor" })).rejects.toBeInstanceOf(
    RankingsUnavailableError,
  );
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
    page.results.map(({ canonicalName, rank, allTimePopulation }) => [
      canonicalName,
      rank,
      allTimePopulation,
    ]),
  ).toEqual([
    ["Alpha Instructor", 1, 4],
    ["Beta Instructor", 1, 4],
    ["Delta Instructor", 3, 4],
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
  expect(page.results[0]?.percentile).toBe(1);
  expect(page.results[0]?.allTimePercentile).toBe(1);
  expect(page.results[0]?.ustSpaceSamples).toBe(11);
  expect(page.results[0]?.sfqSamples).toBe(33);
  expect(page.terms).toEqual([{ termCode: "2510", termName: "2025-26 Fall" }]);

  const searched = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    preset: "learning",
    search: "Second Teacher",
  });
  expect(searched.population.size).toBe(3);
  expect(
    searched.results.map(({ canonicalName, rank }) => [canonicalName, rank]),
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
    { termCode: "2510", courseCode: "COMP 1029C" },
    { termCode: "2510", courseCode: "MATH 2000" },
  ]);
  expect(detail.terms[0]?.criteria.instructor).toEqual({
    bayesian: 1,
    confidence: 1,
    samples: 1,
    cumulativeSamples: 33,
  });
  expect(detail.scoreDistribution.count).toBe(detail.population.size);
});

test("getRankings exposes Course evidence and associated Instructors", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "course-details-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    temporaryDirectory,
    undefined,
    { includeScheduleCourse: true },
  );

  const { getRankings, queryRankings } = await import("@/lib/rankings/server");
  const details = await getRankings(
    { type: "course", coursePrefix: "comp", courseNumber: "2000" },
    { termCode: "2510" },
  );

  expect(details.course).toMatchObject({
    coursePrefix: "COMP",
    courseNumber: "2000",
    courseCode: "COMP 2000",
    title: "Updated Course title",
  });
  expect(details.ranking).toMatchObject({
    entity: "course",
    courseCode: "COMP 2000",
  });
  expect(
    details.terms.find((term) => term.termCode === "2510")?.criteria.content,
  ).toEqual({
    bayesian: 0.25,
    confidence: 1,
    samples: 1,
    cumulativeSamples: 11,
  });
  const population = await queryRankings({
    entity: "course",
    termCode: "2510",
    activity: "all",
  });
  expect(details).toMatchObject({
    generation: population.generation,
    population: population.population,
    configuration: population.configuration,
  });
  expect(details.scoreDistribution.count).toBe(details.population.size);
  expect(
    details.scoreDistribution.bins.reduce((sum, count) => sum + count, 0),
  ).toBe(details.population.size);
  expect(details.scoreDistribution.minimum).toBeLessThanOrEqual(
    details.ranking?.score ?? Number.NEGATIVE_INFINITY,
  );
  expect(details.scoreDistribution.maximum).toBeGreaterThanOrEqual(
    details.ranking?.score ?? Number.POSITIVE_INFINITY,
  );
  expect(details.instructors).toEqual([
    {
      termCode: "2430",
      instructor: expect.objectContaining({
        uuid: "00000000-0000-4000-8000-000000000001",
        canonicalName: "Alpha Instructor",
      }),
    },
    {
      termCode: "2510",
      instructor: expect.objectContaining({
        uuid: "00000000-0000-4000-8000-000000000001",
        canonicalName: "Alpha Instructor",
      }),
    },
  ]);
});

test("Course details retain exact Rank beyond the first 100 results", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "course-detail-rank-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    temporaryDirectory,
    undefined,
    { extraCourses: 110 },
  );

  const { getRankings, queryRankings } = await import("@/lib/rankings/server");
  const firstPage = await queryRankings({
    entity: "course",
    termCode: "2510",
  });
  expect(firstPage.results).toHaveLength(100);
  expect(firstPage.results.some((row) => row.courseCode === "BULK 1109")).toBe(
    false,
  );

  const details = await getRankings(
    { type: "course", coursePrefix: "BULK", courseNumber: "1109" },
    { termCode: "2510" },
  );
  expect(details.ranking).toMatchObject({
    courseCode: "BULK 1109",
    rank: 4,
    rankPopulation: 113,
  });
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

  expect(learning.results[0]?.ustSpaceSamples).toBe(11);
  expect(learning.results[0]?.sfqSamples).toBe(22);
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
  expect(custom.population.size).toBe(4);
  expect(
    custom.results.find((row) => row.courseCode === "COMP 1000")?.score,
  ).toBe(1);

  await expect(
    queryRankings({ entity: "course", weights: { content: -1 } }),
  ).rejects.toThrow("non-negative");
  await expect(
    queryRankings({ entity: "course", weights: { content: 0 } }),
  ).rejects.toThrow("non-zero");

  const large = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    weights: { content: 1e308, teaching: 1e308 },
  });
  expect(large.configuration.weights).toEqual({
    content: 0.5,
    teaching: 0.5,
  });
  const extreme = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    weights: { content: Number.MIN_VALUE, teaching: Number.MAX_VALUE },
  });
  expect(extreme.configuration.weights).toEqual({ teaching: 1 });
});

test("structured filters preserve Rank and Rank of all time", async () => {
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
      rank: 3,
      rankPopulation: 3,
      allTimePopulation: 4,
    }),
  ]);

  const courses = await queryRankings({
    entity: "course",
    termCode: "2510",
    commonCore: ["arts"],
    search: "Alpha Instructor",
  });
  expect(courses.population).toMatchObject({ size: 3, filteredSize: 1 });
  expect(courses.results).toEqual([
    expect.objectContaining({
      courseCode: "COMP 1000",
      title: "Creative Computing",
      rank: 2,
    }),
  ]);

  const cc22Courses = await queryRankings({
    entity: "course",
    termCode: "2510",
    commonCoreScheme: "CC22",
    commonCore: ["science"],
  });
  expect(cc22Courses.results.map((row) => row.courseCode)).toEqual([
    "COMP 1000",
  ]);

  const bySuffixedCourse = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    course: "COMP 1029C",
  });
  expect(bySuffixedCourse.results.map((row) => row.canonicalName)).toEqual([
    "Beta Instructor",
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
  expect(current.nextCursor).toEqual(expect.any(String));

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

  process.env.RANKINGS_SEED_DIR = join(
    process.cwd(),
    "rankings",
    "seed",
    "0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d",
  );
  await expect(
    queryRankings({
      entity: "instructor",
      termCode: "2510",
      limit: 1,
      cursor: current.nextCursor,
    }),
  ).rejects.toBeInstanceOf(StaleRankingsCursorError);
});

test("catalog identity binds Course and association-title cursors", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "ranking-catalog-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "ranking-catalog-second-"));
  temporaryDirectories.push(firstRoot, secondRoot);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(firstRoot);
  const { queryRankings, StaleRankingsCursorError } = await import(
    "@/lib/rankings/server"
  );
  const first = await queryRankings({
    entity: "course",
    termCode: "2510",
    limit: 1,
  });
  expect(first.nextCursor).toEqual(expect.any(String));

  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(secondRoot);
  const catalogPath = join(secondRoot, "course-catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog[0].courseName = "Changed title";
  await writeFile(catalogPath, JSON.stringify(catalog));
  await expect(
    queryRankings({
      entity: "course",
      termCode: "2510",
      limit: 1,
      cursor: first.nextCursor,
    }),
  ).rejects.toBeInstanceOf(StaleRankingsCursorError);
});

test("required catalog metadata fails closed without blocking unrelated Instructor queries", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ranking-catalog-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);
  process.env.RANKINGS_COURSE_CATALOG_FILE = join(
    temporaryDirectory,
    "missing-catalog.json",
  );

  const { queryRankings, RankingsUnavailableError } = await import(
    "@/lib/rankings/server"
  );
  await expect(
    queryRankings({ entity: "course", termCode: "2510" }),
  ).rejects.toBeInstanceOf(RankingsUnavailableError);
  await expect(
    queryRankings({ entity: "instructor", termCode: "2510" }),
  ).resolves.toMatchObject({ population: { entity: "instructor" } });
  await expect(
    queryRankings({ entity: "instructor", termCode: "2510", search: "Math" }),
  ).rejects.toBeInstanceOf(RankingsUnavailableError);

  const malformed = join(temporaryDirectory, "malformed-catalog.json");
  await writeFile(
    malformed,
    JSON.stringify([
      {
        coursePrefix: "COMP",
        courseNumber: "1000",
        courseName: "Broken",
        courseAttributes: "not-an-array",
      },
    ]),
  );
  process.env.RANKINGS_COURSE_CATALOG_FILE = malformed;
  await expect(
    queryRankings({ entity: "course", termCode: "2510" }),
  ).rejects.toBeInstanceOf(RankingsUnavailableError);
});

test("shared historical Instructor Aliases do not establish identity", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ranking-aliases-"));
  temporaryDirectories.push(temporaryDirectory);
  const directory = await makeRankingGeneration(temporaryDirectory);
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const identity of manifest.identities.slice(0, 2))
    identity.aliases.push({
      name: "Shared Historical Name",
      source: "schedule",
      sourceCommit: fixtureSha,
    });
  await writeFile(manifestPath, JSON.stringify(manifest));
  process.env.RANKINGS_SEED_DIR = directory;
  const { queryRankings } = await import("@/lib/rankings/server");

  const page = await queryRankings({
    entity: "instructor",
    termCode: "2510",
  });

  expect(page.results.map((row) => row.canonicalName)).toContain(
    "Alpha Instructor",
  );
  expect(page.results.map((row) => row.canonicalName)).toContain(
    "Beta Instructor",
  );
});

test("search distinguishes strict-ineligible entities from unknown entities", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ranking-unranked-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { queryRankings } = await import("@/lib/rankings/server");
  const unranked = await queryRankings({
    entity: "course",
    termCode: "2510",
    search: "MISS 4000",
  });
  expect(unranked.results).toHaveLength(0);
  expect(unranked.unrankedMatchCount).toBe(1);

  const unknown = await queryRankings({
    entity: "course",
    termCode: "2510",
    search: "UNKNOWN 9999",
  });
  expect(unknown.results).toHaveLength(0);
  expect(unknown.unrankedMatchCount).toBe(0);
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
  expect(first.nextCursor).toEqual(expect.any(String));
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
  ["non-finite", "a non-finite measure"],
  ["null-samples", "missing sample evidence"],
  ["wrong-latest-term", "an invalid latest-Term relation"],
  ["failed-smoke-query", "a failed representative smoke query"],
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

test("zero-sample teaching Instructors and offered Courses receive a Rank from the prior", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rankings-prior-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    temporaryDirectory,
    undefined,
    { includePriorOnly: true },
  );
  const { getRankings, queryRankings } = await import("@/lib/rankings/server");
  const instructors = await queryRankings({
    entity: "instructor",
    termCode: "2510",
  });
  const priorInstructor = instructors.results.find(
    (row) => row.canonicalName === "Prior Instructor",
  );
  expect(priorInstructor).toMatchObject({
    uuid: "00000000-0000-4000-8000-000000000006",
    score: 0.75,
    ustSpaceSamples: 0,
    sfqSamples: 0,
  });
  expect(priorInstructor?.rank).toBeGreaterThan(0);
  const details = await getRankings({
    type: "instructor",
    key: "00000000-0000-4000-8000-000000000006",
  });
  expect(details.ranking).toMatchObject({
    uuid: "00000000-0000-4000-8000-000000000006",
    rank: priorInstructor?.rank,
  });
  const courses = await queryRankings({
    entity: "course",
    termCode: "2510",
  });
  const priorCourse = courses.results.find(
    (row) => row.courseCode === "OFFR 5000",
  );
  expect(priorCourse).toMatchObject({
    score: 0.75,
    ustSpaceSamples: 0,
    sfqSamples: 0,
  });
  expect(priorCourse?.rank).toBeGreaterThan(0);
});

import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { fixtureSha, makeRankingGeneration } from "./rankings-fixture";
import { makeScheduleGeneration } from "./schedule-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function configureDetails() {
  const rankingRoot = await mkdtemp(join(tmpdir(), "instructor-rankings-"));
  const scheduleRoot = await mkdtemp(join(tmpdir(), "instructor-schedule-"));
  temporaryDirectories.push(rankingRoot, scheduleRoot);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    rankingRoot,
    undefined,
    { includeScheduleCourse: true },
  );
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(scheduleRoot);
}

async function updateManifest(
  update: (manifest: {
    identities: Array<Record<string, unknown>>;
    identityEvents?: unknown[];
  }) => void,
) {
  const path = join(process.env.RANKINGS_SEED_DIR as string, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  update(manifest);
  await writeFile(path, JSON.stringify(manifest));
}

afterEach(async () => {
  delete process.env.RANKINGS_SEED_DIR;
  delete process.env.RANKINGS_COURSE_CATALOG_FILE;
  delete process.env.SCHEDULE_SEED_DIR;
  const [{ resetRankingsRuntimeForTests }, { resetScheduleRuntimeForTests }] =
    await Promise.all([
      import("@/lib/rankings/server"),
      import("@/lib/schedule/server"),
    ]);
  await Promise.all([
    resetRankingsRuntimeForTests(),
    resetScheduleRuntimeForTests(),
    ...temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ]);
});

test("Instructor details combine ranking evidence, Courses, Classes, aliases, and reserved community state", async () => {
  await configureDetails();
  const { default: InstructorPage } = await import(
    "@/app/instructors/[key]/page"
  );

  const markup = renderToStaticMarkup(
    await InstructorPage({
      params: Promise.resolve({
        key: "00000000-0000-4000-8000-000000000001",
      }),
      searchParams: Promise.resolve({ term: "2510" }),
    }),
  );

  expect(markup).toContain("Instructor");
  expect(markup).toContain("Alpha Instructor");
  expect(markup).toContain("Ranking evidence and trends");
  expect(markup).toContain("Global Rank");
  expect(markup).toContain("Learning-focused Ranking Preset");
  expect(markup).toContain("Ranking Population");
  expect(markup).toContain("Grade A+");
  expect(markup).toContain("Associated Courses and Classes");
  expect(markup).toContain("COMP 2000");
  expect(markup).toContain("L1 · Class 1001");
  expect(markup).toContain("Instructor aliases and identity history");
  expect(markup).toContain("schedule");
  expect(markup).toContain("Community Reviews");
  expect(markup).toContain("Community Reviews are unavailable");
  expect(markup).toContain("Write a Review");
  expect(markup).toContain("/schedule?term=2510&amp;class=1001&amp;view=cart");
  expect(markup.indexOf("Instructor actions")).toBeLessThan(
    markup.indexOf("Ranking evidence and trends"),
  );
});

test("Instructor routes normalize UUID and ITSC keys while retaining query state", async () => {
  await configureDetails();
  const { default: InstructorPage } = await import(
    "@/app/instructors/[key]/page"
  );

  for (const [key, destination] of [
    ["00000000-0000-4000-8000-000000000002", "/instructors/beta?term=2510"],
    ["BETA", "/instructors/beta?term=2510"],
    [
      "00000000-0000-4000-8000-00000000000A",
      "/instructors/00000000-0000-4000-8000-00000000000a?term=2510",
    ],
  ] as const) {
    try {
      await InstructorPage({
        params: Promise.resolve({ key }),
        searchParams: Promise.resolve({ term: "2510" }),
      });
      throw new Error("Instructor route did not redirect");
    } catch (error) {
      expect(String((error as { digest?: string }).digest)).toContain(
        `NEXT_REDIRECT;replace;${destination};308;`,
      );
    }
  }
});

test("Instructor registry preserves ITSC additions, merge redirects, split resolution flags, and historical access", async () => {
  await configureDetails();
  const splitUuid = "00000000-0000-4000-8000-00000000000a";
  const splitIdentity = {
    uuid: splitUuid,
    canonicalName: "Split Instructor",
    aliases: [
      {
        name: "Split Source Name",
        source: "schedule",
        sourceCommit: fixtureSha,
      },
    ],
  };
  await updateManifest((manifest) => {
    manifest.identities.push(splitIdentity);
    manifest.identityEvents = [
      {
        type: "itsc-added",
        uuid: "00000000-0000-4000-8000-000000000001",
        itsc: "alpha",
        sourceCommit: fixtureSha,
      },
      {
        type: "merge",
        retiredUuid: "00000000-0000-4000-8000-000000000002",
        survivorUuid: "00000000-0000-4000-8000-000000000001",
        sourceCommit: fixtureSha,
      },
      {
        type: "split",
        sourceUuid: "00000000-0000-4000-8000-000000000001",
        newUuid: splitUuid,
        newIdentity: splitIdentity,
        sourceCommit: fixtureSha,
        affectedAssociations: [
          {
            sourceCommit: fixtureSha,
            sourceName: "Alpha Instructor",
            termCode: "2510",
            courseCode: "COMP 2000",
          },
        ],
      },
    ];
  });
  const { getRankings, queryRankings } = await import("@/lib/rankings/server");

  const added = await getRankings({ type: "instructor", key: "alpha" });
  expect(added.instructor.uuid).toBe("00000000-0000-4000-8000-000000000001");
  expect(added.instructor.itsc).toBe("alpha");

  const merged = await getRankings({ type: "instructor", key: "beta" });
  expect(merged.instructor.uuid).toBe(added.instructor.uuid);
  expect(merged.route).toMatchObject({ canonicalKey: "alpha", redirect: true });
  const { default: InstructorPage } = await import(
    "@/app/instructors/[key]/page"
  );
  for (const key of ["beta", "00000000-0000-4000-8000-000000000002"]) {
    try {
      await InstructorPage({
        params: Promise.resolve({ key }),
        searchParams: Promise.resolve({ from: "history" }),
      });
      throw new Error("retired Instructor route did not redirect");
    } catch (error) {
      expect(String((error as { digest?: string }).digest)).toContain(
        "NEXT_REDIRECT;replace;/instructors/alpha?from=history;308;",
      );
    }
  }
  expect(merged.identityHistory.identifiers).toContainEqual({
    type: "itsc",
    value: "beta",
    status: "retired",
    sourceCommit: fixtureSha,
  });
  expect(merged.family.map((identity) => identity.canonicalName)).toEqual([
    "Alpha Instructor",
    "Beta Instructor",
  ]);
  expect(merged.historicalEvidence).toEqual([
    expect.objectContaining({
      instructor: expect.objectContaining({ canonicalName: "Beta Instructor" }),
      courses: expect.arrayContaining([
        { termCode: "2510", courseCode: "MATH 2000" },
      ]),
    }),
  ]);
  expect(merged.courses).not.toContainEqual({
    termCode: "2510",
    courseCode: "COMP 2000",
  });
  const mergedSearch = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    search: "Second Teacher",
  });
  expect(mergedSearch.results.map((result) => result.canonicalName)).toEqual([
    "Alpha Instructor",
  ]);

  const split = await getRankings({ type: "instructor", key: splitUuid });
  expect(split.instructor.uuid).toBe(splitUuid);
  expect(split.terms).toEqual([]);
  expect(split.identityHistory.affectedAssociations).toEqual([
    {
      sourceCommit: fixtureSha,
      sourceName: "Alpha Instructor",
      termCode: "2510",
      courseCode: "COMP 2000",
      status: "needs-resolution",
    },
  ]);
  const course = await getRankings(
    { type: "course", coursePrefix: "COMP", courseNumber: "2000" },
    { termCode: "2510" },
  );
  expect(course.instructors).not.toContainEqual(
    expect.objectContaining({
      termCode: "2510",
      instructor: expect.objectContaining({ uuid: added.instructor.uuid }),
    }),
  );
  const { default: SchedulePage } = await import("@/app/schedule/page");
  const scheduleMarkup = renderToStaticMarkup(
    await SchedulePage({ searchParams: Promise.resolve({ term: "2510" }) }),
  );
  expect(scheduleMarkup).toContain("Alpha Instructor");
  expect(scheduleMarkup).not.toContain('href="/instructors/alpha"');
  expect(scheduleMarkup).not.toContain(
    'href="/instructors/00000000-0000-4000-8000-000000000001"',
  );

  const historical = await getRankings({
    type: "instructor",
    key: "00000000-0000-4000-8000-000000000005",
  });
  expect(historical.instructor.canonicalName).toBe("Historical Instructor");
});

test("merge details retain retired aliases, evidence, Courses, and Classes", async () => {
  await configureDetails();
  await updateManifest((manifest) => {
    manifest.identityEvents = [
      {
        type: "merge",
        retiredUuid: "00000000-0000-4000-8000-000000000002",
        survivorUuid: "00000000-0000-4000-8000-000000000001",
        sourceCommit: fixtureSha,
      },
    ];
  });
  const scheduleManifestPath = join(
    process.env.SCHEDULE_SEED_DIR as string,
    "manifest.json",
  );
  const scheduleManifest = JSON.parse(
    await readFile(scheduleManifestPath, "utf8"),
  );
  scheduleManifest.instructors[0].uuid = "00000000-0000-4000-8000-000000000002";
  await writeFile(scheduleManifestPath, JSON.stringify(scheduleManifest));
  const { default: InstructorPage } = await import(
    "@/app/instructors/[key]/page"
  );

  const markup = renderToStaticMarkup(
    await InstructorPage({
      params: Promise.resolve({
        key: "00000000-0000-4000-8000-000000000001",
      }),
      searchParams: Promise.resolve({ term: "2510" }),
    }),
  );

  expect(markup).toContain("Second Teacher");
  expect(markup).toContain("retired · sfq");
  expect(markup).toContain("Retired identity evidence");
  expect(markup).toContain("MATH 2000");
  expect(markup).toContain("L1 · Class 1001");
});

test("resolved Instructor cross-links use details while unresolved source spellings remain plain text", async () => {
  await configureDetails();
  const [
    { default: CoursePage },
    { default: ClassPage },
    { default: SchedulePage },
    { RankingPage },
  ] = await Promise.all([
    import("@/app/courses/[prefix]/[number]/page"),
    import("@/app/courses/[prefix]/[number]/[termCode]/[section]/page"),
    import("@/app/schedule/page"),
    import("@/app/rankings/rankings-page"),
  ]);

  const course = renderToStaticMarkup(
    await CoursePage({
      params: Promise.resolve({ prefix: "COMP", number: "2000" }),
      searchParams: Promise.resolve({ term: "2510" }),
    }),
  );
  expect(course).toContain(
    'href="/instructors/00000000-0000-4000-8000-000000000001"',
  );
  const scheduleClass = renderToStaticMarkup(
    await ClassPage({
      params: Promise.resolve({
        prefix: "COMP",
        number: "2000",
        termCode: "2510",
        section: "L1",
      }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(scheduleClass).toContain(
    'href="/instructors/00000000-0000-4000-8000-000000000001"',
  );

  const schedule = renderToStaticMarkup(
    await SchedulePage({ searchParams: Promise.resolve({ term: "2510" }) }),
  );
  expect(schedule).toContain(
    'href="/instructors/00000000-0000-4000-8000-000000000001"',
  );
  expect(schedule).toContain("Unresolved Teacher");
  expect(schedule).not.toContain('href="/instructors/Unresolved');

  const rankings = renderToStaticMarkup(
    await RankingPage({
      entity: "instructor",
      searchParams: { term: "2510", q: "Alpha Instructor" },
    }),
  );
  expect(rankings).toContain(
    'href="/instructors/00000000-0000-4000-8000-000000000001"',
  );
});

test("unknown selected Term falls back to latest evidence with an accessible notice", async () => {
  await configureDetails();
  const { default: InstructorPage } = await import(
    "@/app/instructors/[key]/page"
  );

  const markup = renderToStaticMarkup(
    await InstructorPage({
      params: Promise.resolve({
        key: "00000000-0000-4000-8000-000000000001",
      }),
      searchParams: Promise.resolve({ term: "9999" }),
    }),
  );

  expect(markup).toContain("Term 9999 has no ranking evidence");
  expect(markup).toContain("Selected-Term evidence for 2510");
});

test("Instructor identity, Classes, and community remain visible when rankings fail", async () => {
  await configureDetails();
  const rankingFile = join(
    process.env.RANKINGS_SEED_DIR as string,
    "instructor-rankings.parquet",
  );
  await writeFile(rankingFile, "broken ranking data");
  const { default: InstructorPage } = await import(
    "@/app/instructors/[key]/page"
  );

  const markup = renderToStaticMarkup(
    await InstructorPage({
      params: Promise.resolve({
        key: "00000000-0000-4000-8000-000000000001",
      }),
      searchParams: Promise.resolve({ term: "2510" }),
    }),
  );

  expect(markup).toContain("Alpha Instructor");
  expect(markup).toContain("Ranking evidence is unavailable");
  expect(markup).toContain("L1 · Class 1001");
  expect(markup).toContain("Community Reviews");
});

test("unknown Instructor route keys return 404", async () => {
  await configureDetails();
  const { default: InstructorPage } = await import(
    "@/app/instructors/[key]/page"
  );
  try {
    await InstructorPage({
      params: Promise.resolve({ key: "missing" }),
      searchParams: Promise.resolve({}),
    });
    throw new Error("unknown Instructor did not return 404");
  } catch (error) {
    expect(String((error as { digest?: string }).digest)).toContain(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  }
});

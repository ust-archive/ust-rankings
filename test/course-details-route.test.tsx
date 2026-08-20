import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { makeRankingGeneration } from "./rankings-fixture";
import { makeScheduleGeneration } from "./schedule-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function configureDetails() {
  const rankingRoot = await mkdtemp(join(tmpdir(), "course-details-rankings-"));
  const scheduleRoot = await mkdtemp(
    join(tmpdir(), "course-details-schedule-"),
  );
  temporaryDirectories.push(rankingRoot, scheduleRoot);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    rankingRoot,
    undefined,
    { includeScheduleCourse: true },
  );
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(scheduleRoot);
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

test("Course details compose evidence, Offerings, Classes, Instructors, and isolated community state", async () => {
  await configureDetails();
  const { default: CoursePage, dynamic } = await import(
    "@/app/courses/[prefix]/[number]/page"
  );
  expect(dynamic).toBe("force-dynamic");

  const markup = renderToStaticMarkup(
    await CoursePage({
      params: Promise.resolve({ prefix: "COMP", number: "2000" }),
      searchParams: Promise.resolve({ term: "2510" }),
    }),
  );

  expect(markup).toContain("Course");
  expect(markup).toContain("COMP 2000");
  expect(markup).toContain("Updated Course title");
  expect(markup).toContain("Ranking evidence and trends");
  expect(markup).toContain("Global Rank");
  expect(markup).toContain("Course Offerings and Classes");
  expect(markup).toContain("2025-26 Fall");
  expect(markup).toContain("Alpha Instructor");
  expect(markup).toContain("Community Reviews");
  expect(markup).toContain("Community Reviews are unavailable");
  expect(markup).toContain("Write a Review");
  expect(markup).toContain("/schedule?term=2510&amp;class=1001&amp;view=cart");
  expect(markup.indexOf("Course actions")).toBeLessThan(
    markup.indexOf("Ranking evidence and trends"),
  );
});

test("Course page renders a successful public Review read exactly once", async () => {
  await configureDetails();
  const { dynamic, renderCoursePage } = await import(
    "@/app/courses/[prefix]/[number]/page"
  );

  const markup = renderToStaticMarkup(
    await renderCoursePage(
      {
        params: Promise.resolve({ prefix: "COMP", number: "2000" }),
        searchParams: Promise.resolve({ term: "2510" }),
      },
      async () => ({
        unavailable: false,
        reviews: [
          {
            id: "00000000-0000-4000-8000-000000000144",
            revisionId: "00000000-0000-4000-8000-000000000244",
            coursePrefix: "COMP",
            courseNumber: "2000",
            markdown: "The route renders **one public Review**.",
            attribution: "attributed",
            attributionCredit: "Captured Route Student",
            capturedDisplayName: "Captured Route Student",
            license: "CC BY 4.0",
            publishedAt: new Date("2026-08-20T12:00:00.000Z"),
          },
        ],
      }),
    ),
  );

  expect(dynamic).toBe("force-dynamic");
  expect(markup.match(/Captured Route Student/g)).toHaveLength(1);
  expect(markup.match(/The route renders/g)).toHaveLength(1);
  expect(markup).toContain("<strong>one public Review</strong>");
  expect(markup).not.toContain("Community Reviews are unavailable");
});

test("Course Offering and Class routes validate nested relationships and preserve domain distinctions", async () => {
  await configureDetails();
  const [{ default: OfferingPage }, { default: ClassPage }] = await Promise.all(
    [
      import("@/app/courses/[prefix]/[number]/[termCode]/page"),
      import("@/app/courses/[prefix]/[number]/[termCode]/[section]/page"),
    ],
  );

  const offering = renderToStaticMarkup(
    await OfferingPage({
      params: Promise.resolve({
        prefix: "COMP",
        number: "2000",
        termCode: "2430",
      }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(offering).toContain("Course Offering");
  expect(offering).toContain("2024-25 Spring");
  expect(offering).toContain("Earlier Offering");
  expect(offering).toContain("Class 3001");
  expect(offering).toContain("Selected-Term evidence for 2430");
  expect(offering).toContain("Global Rank");
  expect(offering).toContain("Historical criterion evidence by Term");
  expect(offering).toMatch(/2430[\s\S]*0\.10/);

  const classDetails = renderToStaticMarkup(
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
  expect(classDetails).toContain("Class");
  expect(classDetails).toContain("COMP 2000 · L1");
  expect(classDetails).toContain("Class Number 1001");
  expect(classDetails).toContain("30 / 80 enrolled");
  expect(classDetails).toContain("Course Basis");
  expect(classDetails).toContain("Instructor Basis");
  expect(classDetails).toContain(
    "This Class is Review Context, not a signal target",
  );
  expect(classDetails).toContain('href="/courses/COMP/2000#signals"');
  expect(classDetails).toContain(
    'href="/instructors/00000000-0000-4000-8000-000000000001#signals"',
  );
});

test("Course evidence remains visible when the independent Schedule provider is unavailable", async () => {
  const rankingRoot = await mkdtemp(
    join(tmpdir(), "course-details-ranking-only-"),
  );
  temporaryDirectories.push(rankingRoot);
  process.env.RANKINGS_SEED_DIR = await makeRankingGeneration(
    rankingRoot,
    undefined,
    { includeScheduleCourse: true },
  );
  process.env.SCHEDULE_SEED_DIR = join(rankingRoot, "missing-schedule");
  const { default: CoursePage } = await import(
    "@/app/courses/[prefix]/[number]/page"
  );

  const markup = renderToStaticMarkup(
    await CoursePage({
      params: Promise.resolve({ prefix: "COMP", number: "2000" }),
      searchParams: Promise.resolve({}),
    }),
  );

  expect(markup).toContain("Selected-Term evidence for 2510");
  expect(markup).toContain("Global Rank");
  expect(markup).toContain("Course Offerings are unavailable");
  expect(markup).not.toContain(
    "Select a Course Offering to inspect Term evidence",
  );
});

test("ranking detail loading propagates unexpected programming errors", async () => {
  await configureDetails();
  const { loadCourseRankings } = await import("@/app/courses/data");
  const unexpected = new TypeError("unexpected implementation defect");
  const readRankings = async () => {
    throw unexpected;
  };

  await expect(
    loadCourseRankings("COMP", "2000", "2510", readRankings),
  ).rejects.toBe(unexpected);
  expect(await loadCourseRankings("ZZZZ", "9999")).toBeUndefined();
});

test("detail routes permanently normalize Course Prefix and Section while retaining query state", async () => {
  const { default: CoursePage } = await import(
    "@/app/courses/[prefix]/[number]/page"
  );
  try {
    await CoursePage({
      params: Promise.resolve({ prefix: "comp", number: "2000" }),
      searchParams: Promise.resolve({ term: "2510" }),
    });
    throw new Error("Course route did not redirect");
  } catch (error) {
    expect(String((error as { digest?: string }).digest)).toContain(
      "NEXT_REDIRECT;replace;/courses/COMP/2000?term=2510;308;",
    );
  }

  const { default: ClassPage } = await import(
    "@/app/courses/[prefix]/[number]/[termCode]/[section]/page"
  );
  try {
    await ClassPage({
      params: Promise.resolve({
        prefix: "comp",
        number: "2000",
        termCode: "2510",
        section: "l1",
      }),
      searchParams: Promise.resolve({ from: "schedule" }),
    });
    throw new Error("Class route did not redirect");
  } catch (error) {
    expect(String((error as { digest?: string }).digest)).toContain(
      "NEXT_REDIRECT;replace;/courses/COMP/2000/2510/L1?from=schedule;308;",
    );
  }
});

test("loading states preserve Course, Course Offering, and Class distinctions", async () => {
  const [
    { default: CourseLoading },
    { default: OfferingLoading },
    { default: ClassLoading },
  ] = await Promise.all([
    import("@/app/courses/[prefix]/[number]/loading"),
    import("@/app/courses/[prefix]/[number]/[termCode]/loading"),
    import("@/app/courses/[prefix]/[number]/[termCode]/[section]/loading"),
  ]);

  expect(renderToStaticMarkup(<CourseLoading />)).toContain(
    "Loading Course details",
  );
  expect(renderToStaticMarkup(<OfferingLoading />)).toContain(
    "Loading Course Offering details",
  );
  expect(renderToStaticMarkup(<ClassLoading />)).toContain(
    "Loading Class details",
  );
});

test("unsupported Course Offering and Class relationships return 404", async () => {
  await configureDetails();
  const [{ default: OfferingPage }, { default: ClassPage }] = await Promise.all(
    [
      import("@/app/courses/[prefix]/[number]/[termCode]/page"),
      import("@/app/courses/[prefix]/[number]/[termCode]/[section]/page"),
    ],
  );

  for (const render of [
    () =>
      OfferingPage({
        params: Promise.resolve({
          prefix: "COMP",
          number: "2000",
          termCode: "9999",
        }),
        searchParams: Promise.resolve({}),
      }),
    () =>
      ClassPage({
        params: Promise.resolve({
          prefix: "COMP",
          number: "2000",
          termCode: "2510",
          section: "T9",
        }),
        searchParams: Promise.resolve({}),
      }),
  ]) {
    try {
      await render();
      throw new Error("unsupported relationship did not return 404");
    } catch (error) {
      expect(String((error as { digest?: string }).digest)).toContain(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    }
  }
});

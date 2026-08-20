import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { makeRankingGeneration } from "./rankings-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.RANKINGS_SEED_DIR;
  delete process.env.RANKINGS_COURSE_CATALOG_FILE;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("the root permanently redirects to Instructor rankings", async () => {
  const { default: Home } = await import("@/app/page");
  try {
    Home();
    throw new Error("root did not redirect");
  } catch (error) {
    expect(String((error as { digest?: string }).digest)).toContain(
      "NEXT_REDIRECT;replace;/rankings/instructors;308;",
    );
  }
});

test("the public Instructor ranking route renders accepted-generation results", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rankings-route-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );
  const markup = renderToStaticMarkup(
    await InstructorsPage({
      searchParams: Promise.resolve({ term: "2510", q: "Beta" }),
    }),
  );

  expect(markup).toContain("Instructor Rankings");
  expect(markup).toContain("Beta Instructor");
  expect(markup).toContain("Global Rank 1 of 3");
  expect(markup).not.toContain("Alpha Instructor");
  expect(markup).toContain("0123456789abcdef0123456789abcdef01234567");
});

test("a blank Term Code renders the latest Instructor Ranking Population", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "rankings-blank-term-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );
  const markup = renderToStaticMarkup(
    await InstructorsPage({ searchParams: Promise.resolve({ term: "  " }) }),
  );

  expect(markup).toContain('value="2510" selected="">2025-26 Fall');
  expect(markup).not.toContain("Invalid Term Code");
});

test("a malformed Term Code renders an accessible validation message", async () => {
  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );
  const markup = renderToStaticMarkup(
    await InstructorsPage({ searchParams: Promise.resolve({ term: "25x0" }) }),
  );

  expect(markup).toContain("Invalid ranking query");
  expect(markup).toContain("Invalid Term Code");
  expect(markup).toContain('role="alert"');
});

test("the public Course ranking route shares reproducible URL controls", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "course-route-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { default: CoursesPage } = await import("@/app/rankings/courses/page");
  const markup = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({
        term: "2510",
        preset: "grade",
        prefix: "COMP",
        commonCore: "arts",
        q: "Alpha Instructor",
      }),
    }),
  );

  expect(markup).toContain("Course Rankings");
  expect(markup).toContain("COMP 1000");
  expect(markup).toContain("Creative Computing");
  expect(markup).toContain("Grade-focused preset");
  expect(markup).toContain('name="commonCore"');
  expect(markup).toContain("Local Rank");
  expect(markup).not.toContain("MATH 2000");
});

test("ranking routes distinguish every empty, invalid, and stale URL state", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ranking-states-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);
  const { default: CoursesPage } = await import("@/app/rankings/courses/page");
  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );

  const invalid = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({
        preset: "custom",
        weight_content: "0",
      }),
    }),
  );
  expect(invalid).toContain("Invalid ranking query");
  expect(invalid).toContain("non-zero criterion");

  const filterEmpty = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({ term: "2510", prefix: "ZZZZ" }),
    }),
  );
  expect(filterEmpty).toContain(
    "No eligible Courses match these structured filters.",
  );

  const searchEmpty = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({ term: "2510", q: "UNKNOWN 9999" }),
    }),
  );
  expect(searchEmpty).toContain(
    "No Courses in the Local Ranking Population match this search.",
  );

  const unranked = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({ term: "2510", q: "MISS 4000" }),
    }),
  );
  expect(unranked).toContain("matching Course is unranked");

  const { queryRankings } = await import("@/lib/rankings/server");
  const page = await queryRankings({
    entity: "instructor",
    termCode: "2510",
    limit: 1,
  });
  delete process.env.RANKINGS_SEED_DIR;
  const stale = renderToStaticMarkup(
    await InstructorsPage({
      searchParams: Promise.resolve({ term: "2510", cursor: page.nextCursor }),
    }),
  );
  expect(stale).toContain("Ranking page expired");
  expect(stale).toContain('role="alert"');
});

test("the legacy Course ranking route permanently redirects", async () => {
  const { default: LegacyCourseRankings } = await import("@/app/course/page");
  try {
    LegacyCourseRankings();
    throw new Error("legacy route did not redirect");
  } catch (error) {
    expect(String((error as { digest?: string }).digest)).toContain(
      "NEXT_REDIRECT;replace;/rankings/courses;308;",
    );
  }
});

test("an invalid seed fails closed only on the Instructor ranking route", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "rankings-unavailable-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const generation = await makeRankingGeneration(temporaryDirectory);
  const rankingsFile = join(generation, "instructor-rankings.parquet");
  const bytes = await readFile(rankingsFile);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(rankingsFile, bytes);
  process.env.RANKINGS_SEED_DIR = generation;

  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );
  const markup = renderToStaticMarkup(
    await InstructorsPage({ searchParams: Promise.resolve({}) }),
  );

  expect(markup).toContain("Instructor rankings are unavailable");
  expect(markup).toContain('role="alert"');
});

test("Course and Instructor Rankings retain the title, search, Term, and settings hierarchy", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "rankings-hierarchy-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );
  const instructors = renderToStaticMarkup(
    await InstructorsPage({
      searchParams: Promise.resolve({ term: "2510" }),
    }),
  );
  expect(instructors).toContain("UST Rankings");
  expect(instructors).toContain("Instructor Rankings");
  expect(instructors).toContain('name="q"');
  expect(instructors).toContain('type="search"');
  expect(instructors).toContain('name="term"');
  expect(instructors).toContain("Score Formula…");
  expect(instructors).toContain("2025-26 Fall");
  expect(instructors).toContain('name="preset"');
  expect(instructors).toContain('name="activity"');
  expect(instructors).toContain('name="prefix"');
  expect(instructors).toContain('name="course"');
  expect(instructors.indexOf('name="q"')).toBeLessThan(
    instructors.indexOf("Score Formula…"),
  );
  expect(instructors.indexOf('name="term"')).toBeLessThan(
    instructors.indexOf("Score Formula…"),
  );

  const { default: CoursesPage } = await import("@/app/rankings/courses/page");
  const courses = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({
        term: "2510",
        preset: "grade",
        prefix: "COMP",
        commonCore: "arts",
      }),
    }),
  );
  expect(courses).toContain("UST Rankings");
  expect(courses).toContain("Course Rankings");
  expect(courses).toContain("Filter…");
  expect(courses).toContain("Score Formula…");
  expect(courses).toContain('name="commonCore"');
  expect(courses).toContain('name="weight_content"');
});

test("ranking results show identity, ranks, score, and grade and navigate to Details", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rankings-cards-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);

  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );
  const instructors = renderToStaticMarkup(
    await InstructorsPage({
      searchParams: Promise.resolve({ term: "2510", q: "Beta" }),
    }),
  );
  expect(instructors).toContain("Beta Instructor");
  expect(instructors).toContain("Global Rank 1 of 3");
  expect(instructors).not.toContain("Local Rank 1 of 3");
  expect(instructors).toContain("#1");
  expect(instructors).toContain("A+");
  expect(instructors).toContain("1 sample from ust.space");
  expect(instructors).toContain("1 sample from SFQ");
  expect(instructors).toContain('href="/instructors/beta"');
  expect(instructors).not.toContain("Current Courses Taught");
  expect(instructors).not.toContain("Historical Courses Taught");

  const { default: CoursesPage } = await import("@/app/rankings/courses/page");
  const courses = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({ term: "2510", q: "COMP 1000" }),
    }),
  );
  expect(courses).toContain("COMP 1000");
  expect(courses).toContain("Creative Computing");
  expect(courses).toContain('href="/courses/COMP/1000"');
  expect(courses).toContain("Global Rank");
  expect(courses).not.toContain("Current Instructors");
  expect(courses).not.toContain("Historical Instructors");
});

test("empty, invalid, and unavailable ranking states keep the restored structure", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rankings-chrome-"));
  temporaryDirectories.push(temporaryDirectory);
  process.env.RANKINGS_SEED_DIR =
    await makeRankingGeneration(temporaryDirectory);
  const { default: CoursesPage } = await import("@/app/rankings/courses/page");
  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );

  const invalid = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({
        preset: "custom",
        weight_content: "0",
      }),
    }),
  );
  expect(invalid).toContain("UST Rankings");
  expect(invalid).toContain("Score Formula…");
  expect(invalid).toContain('name="q"');
  expect(invalid).toContain("Invalid ranking query");
  expect(invalid).toContain('role="alert"');

  const empty = renderToStaticMarkup(
    await CoursesPage({
      searchParams: Promise.resolve({ term: "2510", prefix: "ZZZZ" }),
    }),
  );
  expect(empty).toContain("UST Rankings");
  expect(empty).toContain("Score Formula…");
  expect(empty).toContain(
    "No eligible Courses match these structured filters.",
  );

  const unavailableDirectory = await mkdtemp(
    join(tmpdir(), "rankings-unavailable-chrome-"),
  );
  temporaryDirectories.push(unavailableDirectory);
  const generation = await makeRankingGeneration(unavailableDirectory);
  const rankingsFile = join(generation, "instructor-rankings.parquet");
  const bytes = await readFile(rankingsFile);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(rankingsFile, bytes);
  process.env.RANKINGS_SEED_DIR = generation;
  const unavailable = renderToStaticMarkup(
    await InstructorsPage({ searchParams: Promise.resolve({}) }),
  );
  expect(unavailable).toContain("UST Rankings");
  expect(unavailable).toContain("Instructor rankings are unavailable");
  expect(unavailable).toContain('role="alert"');
});

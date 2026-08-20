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
  expect(markup).toContain("Global rank 1 of 3");
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

  expect(markup).toContain("2510 · 3 eligible Instructors");
  expect(markup).not.toContain("Invalid Term Code");
});

test("a malformed Term Code renders an accessible validation message", async () => {
  const { default: InstructorsPage } = await import(
    "@/app/rankings/instructors/page"
  );
  const markup = renderToStaticMarkup(
    await InstructorsPage({ searchParams: Promise.resolve({ term: "25x0" }) }),
  );

  expect(markup).toContain("Invalid Term Code");
  expect(markup).toContain('role="alert"');
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

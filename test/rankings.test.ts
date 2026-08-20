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
  expect(page.results[0]?.uuid).toBe("00000000-0000-4000-8000-000000000001");
  expect(page.results[0]?.score).toBe(1);
  expect(page.results[2]?.score).toBe((2 / 3) * 0.4);
  expect(page.results[0]?.percentile).toBe(1);

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
    { termCode: "2510", courseCode: "COMP 1000" },
  ]);
  expect(detail.terms[0]?.criteria.instructor?.bayesian).toBe(1);
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

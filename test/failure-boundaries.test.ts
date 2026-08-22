import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  makeRankingGeneration,
  makeRankingGenerationWithSha,
} from "./rankings-fixture";
import { makeScheduleGeneration } from "./schedule-fixture";

vi.mock("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function installRankingGeneration(directory: string) {
  const { resetRankingsRuntimeForTests } = await import(
    "@/lib/rankings/server"
  );
  await resetRankingsRuntimeForTests(directory);
}

afterEach(async () => {
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

test("public ranking queries cache by accepted generation and omit session fields", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "cache-rank-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "cache-rank-second-"));
  temporaryDirectories.push(firstRoot, secondRoot);
  await installRankingGeneration(await makeRankingGeneration(firstRoot));
  const { queryRankings, resetRankingsRuntimeForTests } = await import(
    "@/lib/rankings/server"
  );
  const first = await queryRankings({ entity: "instructor", termCode: "2510" });
  expect(JSON.stringify(first)).not.toContain("email");
  expect(JSON.stringify(first)).not.toContain("session");
  expect(JSON.stringify(first)).not.toContain("@");

  await resetRankingsRuntimeForTests();
  await installRankingGeneration(
    await makeRankingGenerationWithSha(
      secondRoot,
      "aaaabbbbccccddddeeeeffff0000111122223333",
    ),
  );
  const second = await queryRankings({
    entity: "instructor",
    termCode: "2510",
  });
  expect(second.generation).not.toBe(first.generation);
  expect(second.generation).toBe("aaaabbbbccccddddeeeeffff0000111122223333");
});

test("calendar ETags are bound to the accepted Schedule generation", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "cache-cal-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "cache-cal-second-"));
  temporaryDirectories.push(firstRoot, secondRoot);
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(firstRoot);
  const { generateScheduleCalendar } = await import("@/lib/schedule/calendar");
  const first = await generateScheduleCalendar("2510", [1001]);
  const { resetScheduleRuntimeForTests } = await import(
    "@/lib/schedule/server"
  );
  await resetScheduleRuntimeForTests();
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(
    secondRoot,
    undefined,
    "aaaabbbbccccddddeeeeffff0000111122223333",
  );
  const second = await generateScheduleCalendar("2510", [1001]);
  expect(first.etag).not.toBe(second.etag);
});

test("ranking failure leaves Schedule and public identity routes usable", async () => {
  const rankingRoot = await mkdtemp(join(tmpdir(), "fail-rank-"));
  const scheduleRoot = await mkdtemp(join(tmpdir(), "fail-rank-schedule-"));
  temporaryDirectories.push(rankingRoot, scheduleRoot);
  await installRankingGeneration(join(rankingRoot, "missing"));
  process.env.SCHEDULE_SEED_DIR = await makeScheduleGeneration(scheduleRoot);
  const { querySchedule } = await import("@/lib/schedule/server");
  const { queryRankings, RankingsUnavailableError } = await import(
    "@/lib/rankings/server"
  );
  await expect(
    queryRankings({ entity: "instructor", termCode: "2510" }),
  ).rejects.toBeInstanceOf(RankingsUnavailableError);
  const page = await querySchedule({ termCode: "2510", limit: 1 });
  expect(page.results.length).toBeGreaterThan(0);
});

test("Schedule failure leaves Rankings usable", async () => {
  const rankingRoot = await mkdtemp(join(tmpdir(), "fail-sched-rank-"));
  temporaryDirectories.push(rankingRoot);
  await installRankingGeneration(await makeRankingGeneration(rankingRoot));
  process.env.SCHEDULE_SEED_DIR = join(rankingRoot, "missing-schedule");
  const { queryRankings } = await import("@/lib/rankings/server");
  const { querySchedule, ScheduleUnavailableError } = await import(
    "@/lib/schedule/server"
  );
  const page = await queryRankings({ entity: "instructor", termCode: "2510" });
  expect(page.results.length).toBeGreaterThan(0);
  await expect(querySchedule({ termCode: "2510" })).rejects.toBeInstanceOf(
    ScheduleUnavailableError,
  );
});

test("public ranking pages opt out of shared static cache", async () => {
  const { dynamic: instructors } = await import(
    "@/app/rankings/instructors/page"
  );
  const { dynamic: courses } = await import("@/app/rankings/courses/page");
  expect(instructors).toBe("force-dynamic");
  expect(courses).toBe("force-dynamic");
});

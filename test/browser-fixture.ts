import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fixtureSha, makeRankingGeneration } from "./rankings-fixture.ts";
import {
  makeScheduleGeneration,
  scheduleFixtureSha,
} from "./schedule-fixture.ts";

const rankingsRoot = resolve(".playwright/rankings");
const scheduleRoot = resolve(".playwright/schedule");

export const browserFixtureEnvironment = {
  TEST_RANKING_GENERATION: resolve(rankingsRoot, fixtureSha),
  TEST_SCHEDULE_GENERATION: resolve(scheduleRoot, scheduleFixtureSha),
};

export async function generateBrowserFixtures() {
  await Promise.all([
    rm(rankingsRoot, { force: true, recursive: true }),
    rm(scheduleRoot, { force: true, recursive: true }),
  ]);
  await Promise.all([
    makeRankingGeneration(rankingsRoot, undefined, {
      extraCourses: 105,
      extraInstructors: 105,
      includeScheduleCourse: true,
    }),
    makeScheduleGeneration(scheduleRoot),
  ]);
}

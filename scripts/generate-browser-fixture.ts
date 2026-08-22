import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { makeRankingGeneration } from "../test/rankings-fixture.ts";
import { makeScheduleGeneration } from "../test/schedule-fixture.ts";

const rankingsRoot = resolve(".playwright/rankings");
const scheduleRoot = resolve(".playwright/schedule");
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

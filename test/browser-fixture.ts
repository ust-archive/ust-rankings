import { createHash } from "node:crypto";
import { cp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDeliveryGeneration } from "../data/src/delivery.ts";
import { fixtureSha, makeRankingGeneration } from "./rankings-fixture.ts";
import {
  makeScheduleGeneration,
  scheduleFixtureSha,
} from "./schedule-fixture.ts";

const rankingsRoot = resolve(".playwright/rankings");
const rankingDeliveryRoot = resolve(".playwright/ranking-delivery");
const scheduleRoot = resolve(".playwright/schedule");
const deliveryRoot = resolve(".playwright/delivery");
const deliveryBaseUrl = "http://127.0.0.1:17832";
const rankingInputs = [
  "courses.parquet",
  "course-ratings.parquet",
  "instructor-ratings.parquet",
  "course-instructors.parquet",
  "instructor-identities.parquet",
  "instructor-aliases.parquet",
  "instructor-identity-events.parquet",
  "instructor-split-affected-associations.parquet",
] as const;

export const browserFixtureEnvironment = {
  NEXT_PUBLIC_DELIVERY_BASE_URL: deliveryBaseUrl,
  TEST_RANKING_GENERATION: resolve(rankingsRoot, fixtureSha),
  TEST_SCHEDULE_GENERATION: resolve(scheduleRoot, scheduleFixtureSha),
};

async function sha256(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function generateBrowserFixtures() {
  await Promise.all([
    rm(rankingsRoot, { force: true, recursive: true }),
    rm(rankingDeliveryRoot, { force: true, recursive: true }),
    rm(scheduleRoot, { force: true, recursive: true }),
    rm(deliveryRoot, { force: true, recursive: true }),
  ]);
  const [rankingDirectory, scheduleDirectory] = await Promise.all([
    makeRankingGeneration(rankingsRoot, undefined, {
      associationCorrections: [
        {
          correctionType: "calibration",
          sourceCommit: fixtureSha,
          targetUuid: "00000000-0000-4000-8000-000000000001",
          sourceName: "Calibrated Legacy Name",
          termCode: "2510",
          courseCode: "MATH 2000",
        },
        {
          correctionType: "split",
          sourceCommit: fixtureSha,
          targetUuid: "00000000-0000-4000-8000-000000000002",
          sourceName: "Alpha Instructor",
          termCode: "2510",
          courseCode: "COMP 1000",
        },
      ],
      extraCourses: 105,
      extraInstructors: 105,
      identityEvents: [
        {
          type: "merge",
          retiredUuid: "00000000-0000-4000-8000-000000000005",
          survivorUuid: "00000000-0000-4000-8000-000000000001",
          sourceCommit: fixtureSha,
        },
        {
          type: "split",
          sourceUuid: "00000000-0000-4000-8000-000000000001",
          newUuid: "00000000-0000-4000-8000-000000000002",
          sourceCommit: fixtureSha,
        },
      ],
      includePriorOnly: true,
      includeScheduleCourse: true,
      sameNameAssociations: true,
    }),
    makeScheduleGeneration(scheduleRoot),
  ]);
  const rankingDeliveryDirectory = resolve(rankingDeliveryRoot, fixtureSha);
  await cp(rankingDirectory, rankingDeliveryDirectory, { recursive: true });
  const artifacts = Object.fromEntries(
    await Promise.all(
      rankingInputs.map(async (name) => {
        const path = resolve(rankingDeliveryDirectory, name);
        return [
          name,
          { size: (await stat(path)).size, sha256: await sha256(path) },
        ];
      }),
    ),
  );
  await writeFile(
    resolve(rankingDeliveryDirectory, "manifest.json"),
    `${JSON.stringify({ sourceCommit: fixtureSha, artifacts })}\n`,
  );
  const delivery = await buildDeliveryGeneration({
    rankingDirectory: rankingDeliveryDirectory,
    rankingRevision: fixtureSha,
    scheduleDirectory,
    scheduleRevision: scheduleFixtureSha,
    outputDirectory: deliveryRoot,
  });
  for (const artifact of Object.values(delivery.manifest.artifacts))
    artifact.url = `${deliveryBaseUrl}/${delivery.generation}/${new URL(artifact.url).pathname.split("/").at(-1)}`;
  await writeFile(
    resolve(delivery.directory, "manifest.json"),
    `${JSON.stringify(delivery.manifest, null, 2)}\n`,
  );
  await writeFile(
    resolve(deliveryRoot, "latest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generation: delivery.generation,
      manifest: `${deliveryBaseUrl}/${delivery.generation}/manifest.json`,
    })}\n`,
  );
}

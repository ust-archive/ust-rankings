import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildDeliveryGeneration } from "../data/src/delivery.ts";
import {
  fixtureSha,
  makeRankingGeneration,
} from "../data/test/rankings-fixture.ts";
import {
  makeScheduleGeneration,
  scheduleFixtureSha,
} from "../data/test/schedule-fixture.ts";

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

export const browserRolloverGeneration = "f".repeat(64);
export const browserServerIndexSecret =
  "browser-server-index-activation-secret";

export const browserFixtureEnvironment = {
  CRON_SECRET: browserServerIndexSecret,
  NEXT_PUBLIC_DELIVERY_BASE_URL: deliveryBaseUrl,
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
  const rolloverDirectory = resolve(deliveryRoot, browserRolloverGeneration);
  await mkdir(rolloverDirectory);
  const serverIndex = JSON.parse(
    gunzipSync(
      await readFile(resolve(delivery.directory, "server-index.json.gz")),
    ).toString("utf8"),
  ) as Record<string, unknown>;
  serverIndex.generation = browserRolloverGeneration;
  const rolloverInstructor = (
    serverIndex.instructors as Array<Record<string, unknown>>
  ).find(
    (instructor) => instructor.uuid === "00000000-0000-4000-8000-000000000001",
  );
  if (!rolloverInstructor) throw new Error("Missing rollover Instructor");
  rolloverInstructor.canonicalName = "Rollover Instructor";
  rolloverInstructor.itsc = "alpha";
  await writeFile(
    resolve(rolloverDirectory, "server-index.json.gz"),
    gzipSync(Buffer.from(`${JSON.stringify(serverIndex)}\n`), { level: 9 }),
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

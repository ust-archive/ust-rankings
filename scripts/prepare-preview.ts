import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildDeliveryGeneration } from "../data/src/delivery.ts";

const run = promisify(execFile);
const root = resolve(".");
const previewRoot = resolve(".preview");
const rankingDirectory = join(previewRoot, "rankings");
const scheduleDirectory = join(previewRoot, "schedule");
const deliveryDirectory = resolve(".playwright/delivery");
const deliveryBaseUrl = "http://127.0.0.1:17832";
const rankingFiles = [
  "courses.parquet",
  "course-ratings.parquet",
  "instructor-ratings.parquet",
  "course-instructors.parquet",
  "instructor-identities.parquet",
  "instructor-aliases.parquet",
  "instructor-identity-events.parquet",
  "instructor-split-affected-associations.parquet",
] as const;
const scheduleFiles = [
  "courses.parquet",
  "classes.parquet",
  "canonical/class_records.parquet",
] as const;
const revisionPattern = /^[0-9a-f]{40}$/;

async function datasetRevision(repository: string) {
  const response = await fetch(
    `https://huggingface.co/api/datasets/${repository}/revision/main`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Could not resolve ${repository} revision`);
  const value = (await response.json()) as { sha?: unknown };
  if (typeof value.sha !== "string" || !revisionPattern.test(value.sha))
    throw new Error(`Invalid ${repository} revision`);
  return value.sha;
}

async function download(
  repository: string,
  revision: string,
  directory: string,
  files: readonly string[],
) {
  await run(
    "hf",
    [
      "download",
      repository,
      "--type",
      "dataset",
      "--revision",
      revision,
      "--local-dir",
      directory,
      ...files.flatMap((file) => ["--include", file]),
    ],
    { cwd: root, env: process.env, maxBuffer: 4 * 1024 * 1024 },
  );
}

async function digest(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function writeSourceManifest(
  directory: string,
  revision: string,
  files: readonly string[],
) {
  const artifacts = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        {
          size: (await stat(join(directory, file))).size,
          sha256: await digest(join(directory, file)),
        },
      ]),
    ),
  );
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify({ sourceCommit: revision, artifacts }, null, 2)}\n`,
  );
}

const rankingRevision = await datasetRevision("ust-archive/ust-rankings");
const scheduleRevision = await datasetRevision("ust-archive/schedule");
await rm(previewRoot, { recursive: true, force: true });
await rm(deliveryDirectory, { recursive: true, force: true });
await mkdir(rankingDirectory, { recursive: true });
await mkdir(scheduleDirectory, { recursive: true });
await Promise.all([
  download(
    "ust-archive/ust-rankings",
    rankingRevision,
    rankingDirectory,
    rankingFiles,
  ),
  download(
    "ust-archive/schedule",
    scheduleRevision,
    scheduleDirectory,
    scheduleFiles,
  ),
]);
await Promise.all([
  writeSourceManifest(rankingDirectory, rankingRevision, rankingFiles),
  writeSourceManifest(scheduleDirectory, scheduleRevision, scheduleFiles),
]);
const delivery = await buildDeliveryGeneration({
  rankingDirectory,
  scheduleDirectory,
  rankingRevision,
  scheduleRevision,
  outputDirectory: deliveryDirectory,
});
for (const artifact of Object.values(delivery.manifest.artifacts))
  artifact.url = `${deliveryBaseUrl}/${delivery.generation}/${artifact.url.split("/").at(-1)}`;
await writeFile(
  join(delivery.directory, "manifest.json"),
  `${JSON.stringify(delivery.manifest, null, 2)}\n`,
);
await writeFile(
  join(deliveryDirectory, "latest.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    generation: delivery.generation,
    manifest: `${deliveryBaseUrl}/${delivery.generation}/manifest.json`,
  })}\n`,
);
console.log(
  JSON.stringify(
    {
      rankingRevision,
      scheduleRevision,
      generation: delivery.generation,
      directory: delivery.directory,
      waitlistSource: delivery.manifest.waitlistEvidence.sourceArtifact,
      waitlistRows: "pre-computed by DuckDB",
    },
    null,
    2,
  ),
);

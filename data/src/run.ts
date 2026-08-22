import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { assignInstructorIdentities } from "./identities.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliArguments = process.argv.slice(2);
const unknownArgument = cliArguments.find((argument) => argument !== "--init");
if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`);
const initializeIdentityHistory = cliArguments.includes("--init");
const outputDir = resolve(root, process.env.RANKINGS_OUTPUT_DIR ?? "out");
const localDataDir = process.env.RANKINGS_DATA_DIR;

const revisions = {
  catalog: process.env.CATALOG_REVISION ?? "main",
  schedule: process.env.SCHEDULE_REVISION ?? "main",
  reviews: process.env.REVIEWS_REVISION ?? "main",
  sfq: process.env.SFQ_REVISION ?? "main",
} satisfies Record<string, string>;

function sqlPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function source(localPath: string, remotePath: string): string {
  return localDataDir ? sqlPath(resolve(localDataDir, localPath)) : remotePath;
}

const sources = {
  catalog_courses: source(
    "catalog/courses.parquet",
    `hf://datasets/ust-archive/catalog@${revisions.catalog}/courses.parquet`,
  ),
  schedule_classes: source(
    "schedule/classes.parquet",
    `hf://datasets/ust-archive/schedule@${revisions.schedule}/classes.parquet`,
  ),
  schedule_courses: source(
    "schedule/courses.parquet",
    `hf://datasets/ust-archive/schedule@${revisions.schedule}/courses.parquet`,
  ),
  reviews: source(
    "ust-space/reviews.parquet",
    `hf://datasets/ust-archive/ust-space@${revisions.reviews}/reviews.parquet`,
  ),
  sfq_instructors: source(
    "sfq/canonical/instructor_records.parquet",
    `hf://datasets/ust-archive/sfq@${revisions.sfq}/canonical/instructor_records.parquet`,
  ),
  sfq_sections: source(
    "sfq/canonical/section_records.parquet",
    `hf://datasets/ust-archive/sfq@${revisions.sfq}/canonical/section_records.parquet`,
  ),
};

const outputs = {
  courses_parquet: sqlPath(resolve(outputDir, "courses.parquet")),
  course_ratings_parquet: sqlPath(resolve(outputDir, "course-ratings.parquet")),
  instructor_ratings_parquet: sqlPath(
    resolve(outputDir, "instructor-ratings.parquet"),
  ),
  course_rankings_parquet: sqlPath(
    resolve(outputDir, "course-rankings.parquet"),
  ),
  instructor_rankings_parquet: sqlPath(
    resolve(outputDir, "instructor-rankings.parquet"),
  ),
  course_instructors_parquet: sqlPath(
    resolve(outputDir, "course-instructors.parquet"),
  ),
  instructor_identities_parquet: sqlPath(
    resolve(outputDir, "instructor-identities.parquet"),
  ),
  instructor_aliases_parquet: sqlPath(
    resolve(outputDir, "instructor-aliases.parquet"),
  ),
  instructor_identity_events_parquet: sqlPath(
    resolve(outputDir, "instructor-identity-events.parquet"),
  ),
  instructor_split_affected_associations_parquet: sqlPath(
    resolve(outputDir, "instructor-split-affected-associations.parquet"),
  ),
};

async function executeFile(
  connection: DuckDBConnection,
  file: string,
): Promise<void> {
  const sql = await readFile(resolve(root, "sql", file), "utf8");
  await connection.run(sql);
}

await mkdir(outputDir, { recursive: true });

const instance = await DuckDBInstance.create();
const connection = await instance.connect();
const startedAt = performance.now();

try {
  // Keep floating-point aggregates reproducible across repeated builds.
  await connection.run("SET threads = 1");

  if (!localDataDir) {
    await connection.run("INSTALL httpfs; LOAD httpfs;");
    if (process.env.HF_TOKEN) {
      await connection.run(
        "CREATE SECRET hf_token (TYPE huggingface, TOKEN $token)",
        { token: process.env.HF_TOKEN },
      );
    } else {
      await connection.run(
        "CREATE SECRET hf_token (TYPE huggingface, PROVIDER credential_chain)",
      );
    }
  }

  for (const [name, value] of Object.entries({ ...sources, ...outputs })) {
    await connection.run(`SET VARIABLE ${name} = $value`, { value });
  }

  await executeFile(connection, "00_sources.sql");

  const catalogValidation = await connection.runAndReadAll(`
    SELECT
      (SELECT count(*)::INTEGER FROM course_dimension) AS course_rows,
      (SELECT count(*)::INTEGER FROM course_dimension
        WHERE prefix IS NULL OR trim(prefix) = ''
          OR number IS NULL OR trim(number) = ''
          OR title IS NULL OR trim(title) = ''
          OR attributes IS NULL) AS invalid_rows,
      (SELECT count(*)::INTEGER FROM (
        SELECT prefix, number
        FROM course_dimension
        GROUP BY prefix, number
        HAVING count(*) > 1
      )) AS conflicting_courses
  `);
  const [{ course_rows = 0, invalid_rows = 0, conflicting_courses = 0 } = {}] =
    catalogValidation.getRowObjectsJson() as Array<Record<string, number>>;
  if (course_rows === 0) throw new Error("Course dimension is empty");
  if (invalid_rows > 0)
    throw new Error(`Course dimension has ${invalid_rows} invalid row(s)`);
  if (conflicting_courses > 0)
    throw new Error(
      `Course dimension has ${conflicting_courses} conflicting Course(s)`,
    );

  for (const file of ["10_observations.sql", "20_ratings.sql"]) {
    await executeFile(connection, file);
  }

  await assignInstructorIdentities(connection, {
    previousGenerationDir: process.env.RANKINGS_PREVIOUS_GENERATION_DIR,
    initialize: initializeIdentityHistory,
    sourceCommit: process.env.RANKINGS_IDENTITY_COMMIT ?? "local",
    correctionsPath: process.env.RANKINGS_INSTRUCTOR_REGISTRY_FILE,
  });

  await executeFile(connection, "30_export.sql");

  const summary = await connection.runAndReadAll(`
    SELECT
      (SELECT count(*) FROM observations) AS observations,
      (SELECT count(*) FROM course_entities) AS courses,
      (SELECT count(*) FROM instructor_entities) AS instructors,
      (SELECT count(*) FROM course_ratings) AS course_rating_terms,
      (SELECT count(*) FROM instructor_ratings) AS instructor_rating_terms
  `);
  console.table(summary.getRowObjectsJson());
  console.log(
    `Built rating data in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`,
  );
} finally {
  connection.closeSync();
  instance.closeSync();
}

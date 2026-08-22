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
const localDataDir = process.env.DATA_DIR;
const backtestRowsPath = process.env.RANKINGS_BACKTEST_ROWS;

function numberSetting(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`Invalid ${name}: ${process.env[name]}`);
  return value;
}

const modelSettings = {
  timeliness_base: numberSetting("RANKINGS_TIMELINESS_BASE", 0.65),
  course_instructor_multiplier: numberSetting(
    "RANKINGS_COURSE_INSTRUCTOR_MULTIPLIER",
    12,
  ),
  review_vote_scale: numberSetting("RANKINGS_REVIEW_VOTE_SCALE", 1),
  sfq_rate_penalty: numberSetting("RANKINGS_SFQ_RATE_PENALTY", 1),
  context_affects_uncertainty:
    process.env.RANKINGS_CONTEXT_AFFECTS_UNCERTAINTY !== "false",
};

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

  for (const [name, value] of Object.entries({
    ...sources,
    ...outputs,
    ...modelSettings,
  })) {
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

  await executeFile(connection, "10_observations.sql");

  await assignInstructorIdentities(connection, {
    previousGenerationDir: process.env.RANKINGS_PREVIOUS_GENERATION_DIR,
    initialize: initializeIdentityHistory,
    sourceCommit: process.env.RANKINGS_IDENTITY_COMMIT ?? "local",
    correctionsPath: process.env.RANKINGS_INSTRUCTOR_REGISTRY_FILE,
  });

  await executeFile(connection, "20_ratings.sql");

  if (backtestRowsPath) {
    await mkdir(dirname(resolve(backtestRowsPath)), { recursive: true });
    await connection.run("SET VARIABLE backtest_rows = $value", {
      value: sqlPath(resolve(backtestRowsPath)),
    });
    await connection.run(`
      COPY (
        WITH course_observations AS (
          SELECT
            subject AS prefix,
            code AS number,
            term_num,
            criterion,
            rating,
            weight
          FROM observations
        ), outcomes AS (
          SELECT
            concat_ws(chr(31), prefix, number) AS course_id,
            term_num,
            criterion,
            rating,
            weight
          FROM course_observations
        )
        SELECT
          predictions.entity_id AS course_id,
          predictions.term_num AS cutoff_term,
          outcomes.term_num AS outcome_term,
          predictions.criterion,
          predictions.bayesian * stats.stddev + stats.mean AS prediction,
          stats.stddev * sqrt(
            pow(predictions.posterior_stddev, 2) + 1 / outcomes.weight
          )
            AS predictive_stddev,
          predictions.cumulative_samples,
          outcomes.rating AS outcome
        FROM scored_entity_ratings AS predictions
        JOIN outcomes
          ON outcomes.course_id = predictions.entity_id
         AND outcomes.criterion = predictions.criterion
         AND outcomes.term_num > predictions.term_num
         AND outcomes.term_num <= predictions.term_num + 4
        JOIN criterion_stats AS stats
          ON stats.criterion = predictions.criterion
         AND stats.term_num = predictions.term_num
         AND stats.stddev > 0
        WHERE predictions.family = 'course'
      ) TO (getvariable('backtest_rows')) (FORMAT parquet, COMPRESSION zstd)
    `);
  }
  await executeFile(connection, "30_export.sql");

  const summary = await connection.runAndReadAll(`
    SELECT
      (SELECT count(*) FROM observations) AS observations,
      (SELECT count(*) FROM course_entities) AS courses,
      (SELECT count(*) FROM resolved_instructor_entities) AS instructors,
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

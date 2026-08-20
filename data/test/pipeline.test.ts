import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

const root = resolve(import.meta.dir, "..");

async function copyQuery(
  connection: DuckDBConnection,
  path: string,
  query: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await connection.run("SET VARIABLE fixture_path = $path", {
    path: path.replaceAll("\\", "/"),
  });
  await connection.run(
    `COPY (${query}) TO (getvariable('fixture_path')) (FORMAT parquet)`,
  );
}

async function makeFixtures(dataDir: string): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    await copyQuery(
      connection,
      join(dataDir, "schedule", "courses.parquet"),
      `
      SELECT * FROM (VALUES
        (100, 'high', TIMESTAMP '2025-01-01', 'ACTIVE', 'COMP', '1000', '2510'),
        (100, 'low',  TIMESTAMP '2025-01-01', 'ACTIVE', 'COMP', '2000', '2510')
      ) AS courses(term_num, id, "timestamp", status, prefix, number, term_code)
    `,
    );

    await copyQuery(
      connection,
      join(dataDir, "schedule", "classes.parquet"),
      `
      SELECT * FROM (VALUES
        (100, 'class-high', TIMESTAMP '2025-01-01', 'ACTIVE',
          [{'instructors': [
            'ALPHA, Alice Beatrice', 'Adam Blake DELTA',
            'WANG, Wei', 'WEI, Wang', 'TBA', 'MSC(TLE) PROGRAM, .'
          ]}], 'high', 'E', 'LEC'),
        (100, 'class-low', TIMESTAMP '2025-01-01', 'ACTIVE',
          [{'instructors': ['Cara Gamma']}], 'low', 'E', 'LEC')
      ) AS classes(term_num, number, "timestamp", status, schedules, course_id, role, type)
    `,
    );

    await copyQuery(
      connection,
      join(dataDir, "ust-space", "reviews.parquet"),
      `
      SELECT * FROM (VALUES
        ('high-review', TIMESTAMP '2025-01-01', 'ACTIVE', '2025-26 Fall', 3, 4,
          5.0, 5.0, 5.0, 4.0, 'COMP', '1000', [{'name': 'ALPHA, ALICE BEATRICE'}]),
        ('low-review', TIMESTAMP '2025-01-01', 'ACTIVE', '2025-26 Fall', 0, 2,
          1.0, 1.0, 1.0, 2.0, 'COMP', '2000', [{'name': 'Cara Gamma'}]),
        ('history-review', TIMESTAMP '2024-08-01', 'ACTIVE', '2024-25 Summer', 0, 0,
          3.0, 3.0, 3.0, 3.0, 'HIST', '3000', [{'name': 'Dora Delta'}]),
        ('deleted-review', TIMESTAMP '2025-01-01', 'ACTIVE', '2025-26 Fall', 1, 1,
          5.0, 5.0, 5.0, 5.0, 'GONE', '9999', [{'name': 'TBA'}]),
        ('deleted-review', TIMESTAMP '2025-02-01', 'INACTIVE', '2025-26 Fall', 1, 1,
          5.0, 5.0, 5.0, 5.0, 'GONE', '9999', [{'name': 'TBA'}])
      ) AS reviews(
        hash, "timestamp", status, semester, upvote_count, vote_count,
        content_rating, teaching_rating, grading_rating, workload_rating,
        subject, number, instructors
      )
    `,
    );

    const sfqColumns = `
      version, term_num, term_code, school_code, department_code, prefix, number,
      section, instructor_name, survey_num, num_invites, is_low_response_rate,
      response_rate, course_overall_mean, course_overall_sd,
      instructor_overall_mean, instructor_overall_sd, date_of_preparation,
      "timestamp", status, sha256
    `;
    await copyQuery(
      connection,
      join(dataDir, "sfq", "canonical", "instructor_records.parquet"),
      `
      SELECT * FROM (VALUES
        ('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '1000', 'L1', 'Alice Beatrice ALPHA', 1,
          100, false, 0.8, 4.8, 0.2, 4.9, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'ia'),
        ('v1', 100, '2510', 'SENG', 'ECE', 'COMP', '1000', 'L1', 'Alice Beatrice ALPHA', 99,
          100, false, 0.8, 4.8, 0.2, 4.9, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'ia'),
        ('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '1000', 'L1', 'Adam Blake DELTA', 2,
          100, false, 0.8, 4.8, 0.2, 4.7, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'ib'),
        ('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '1000', 'L1', 'DELTA, A B', 4,
          100, false, 0.8, 4.8, 0.2, 4.6, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'id'),
        ('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '2000', 'L1', 'Cara Gamma', 3,
          100, false, 0.8, 2.0, 0.2, 2.0, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'ic'),
        ('v1', 100, '2510', 'SENG', 'ECE', 'COMP', '2000', 'L1', 'Cara Gamma', 33,
          100, false, 0.8, 2.1, 0.2, 2.1, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'ic')
      ) AS sfq(${sfqColumns})
    `,
    );

    const sectionColumns = `
      version, term_num, term_code, school_code, department_code, prefix, number,
      section, num_invites, is_low_response_rate, response_rate,
      course_overall_mean, course_overall_sd, instructor_overall_mean,
      instructor_overall_sd, date_of_preparation, "timestamp", status, sha256
    `;
    await copyQuery(
      connection,
      join(dataDir, "sfq", "canonical", "section_records.parquet"),
      `
      SELECT * FROM (VALUES
        ('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '1000', 'L1',
          100, false, 0.8, 4.8, 0.2, 4.8, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'sa'),
        ('v1', 100, '2510', 'SENG', 'ECE', 'COMP', '1000', 'L1',
          100, false, 0.8, 4.8, 0.2, 4.8, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'sa'),
        ('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '2000', 'L1',
          100, false, 0.8, 2.0, 0.2, 2.0, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'sb'),
        ('v1', 100, '2510', 'SENG', 'ECE', 'COMP', '2000', 'L1',
          100, false, 0.8, 2.1, 0.2, 2.1, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'sb')
      ) AS sfq_sections(${sectionColumns})
    `,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function runPipeline(dataDir: string, runDir: string): string {
  const outputDir = join(runDir, "out");
  const result = Bun.spawnSync({
    cmd: [process.execPath, join(root, "src", "run.ts")],
    cwd: root,
    env: {
      ...process.env,
      RANKINGS_DATA_DIR: dataDir,
      RANKINGS_OUTPUT_DIR: outputDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(
    result.exitCode,
    0,
    result.stderr.toString() || result.stdout.toString(),
  );
  return outputDir;
}

async function rows(sql: string) {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJS();
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function parquet(outputDir: string, name: string): string {
  return join(outputDir, `${name}.parquet`)
    .replaceAll("\\", "/")
    .replaceAll("'", "''");
}

const outputColumns = {
  "course-ratings": [
    "subject",
    "code",
    "term_num",
    "term_code",
    "is_offered",
    "criterion",
    "rating",
    "bayesian",
    "confidence",
    "samples",
    "cumulative_samples",
    "effective_samples",
    "reliability",
    "posterior_stddev",
  ],
  "instructor-ratings": [
    "name",
    "term_num",
    "term_code",
    "is_teaching",
    "criterion",
    "rating",
    "bayesian",
    "confidence",
    "samples",
    "cumulative_samples",
    "effective_samples",
    "reliability",
    "posterior_stddev",
  ],
  "course-rankings": [
    "subject",
    "code",
    "term_num",
    "term_code",
    "is_offered",
    "criterion",
    "rating",
    "bayesian",
    "confidence",
    "samples",
    "cumulative_samples",
    "effective_samples",
    "reliability",
    "posterior_stddev",
  ],
  "instructor-rankings": [
    "name",
    "term_num",
    "term_code",
    "is_teaching",
    "criterion",
    "rating",
    "bayesian",
    "confidence",
    "samples",
    "cumulative_samples",
    "effective_samples",
    "reliability",
    "posterior_stddev",
  ],
  "course-instructors": ["name", "term_num", "term_code", "subject", "code"],
} as const;

async function snapshot(outputDir: string, name: keyof typeof outputColumns) {
  const path = parquet(outputDir, name);
  const schema = await rows(`DESCRIBE SELECT * FROM read_parquet('${path}')`);
  const data = await rows(`SELECT * FROM read_parquet('${path}') ORDER BY ALL`);
  return { schema, data };
}

test("DuckDB pipeline writes reproducible relational marts", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-rankings-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);

    const first = runPipeline(dataDir, join(temp, "first"));
    const second = runPipeline(dataDir, join(temp, "second"));
    const courseRatings = parquet(first, "course-ratings");
    const instructorRatings = parquet(first, "instructor-ratings");
    const courseRankings = parquet(first, "course-rankings");
    const instructorRankings = parquet(first, "instructor-rankings");
    const courseInstructors = parquet(first, "course-instructors");

    for (const [name, columns] of Object.entries(outputColumns)) {
      const artifact = await snapshot(
        first,
        name as keyof typeof outputColumns,
      );
      assert.deepEqual(
        artifact.schema.map((column) => column.column_name),
        columns,
        `${name}.parquet schema`,
      );
      assert.ok(artifact.data.length > 0, `${name}.parquet is empty`);
    }

    assert.deepEqual(
      await rows(`
      SELECT count(*)::INTEGER AS count
      FROM read_parquet('${courseRatings}')
      WHERE subject = 'GONE'
    `),
      [{ count: 0 }],
    );

    assert.deepEqual(
      await rows(`
      SELECT samples::INTEGER AS samples, round(confidence, 8) AS confidence
      FROM read_parquet('${courseRatings}')
      WHERE subject = 'COMP' AND code = '1000'
        AND term_num = 100 AND criterion = 'course'
    `),
      [{ samples: 80, confidence: 864 }],
    );

    assert.deepEqual(
      await rows(`
      SELECT samples::INTEGER AS samples, round(confidence, 8) AS confidence
      FROM read_parquet('${instructorRatings}')
      WHERE name = 'ALPHA, Alice Beatrice'
        AND term_num = 100 AND criterion = 'instructor'
    `),
      [{ samples: 80, confidence: 72 }],
    );

    // Rows from one artifact are distinct evidence when their measurements differ.
    assert.deepEqual(
      await rows(`
      SELECT samples::INTEGER AS samples, round(confidence, 8) AS confidence
      FROM read_parquet('${courseRatings}')
      WHERE subject = 'COMP' AND code = '2000'
        AND term_num = 100 AND criterion = 'course'
    `),
      [{ samples: 160, confidence: 1728 }],
    );

    assert.deepEqual(
      await rows(`
      SELECT samples::INTEGER AS samples, round(confidence, 8) AS confidence
      FROM read_parquet('${instructorRatings}')
      WHERE name = 'Cara Gamma'
        AND term_num = 100 AND criterion = 'instructor'
    `),
      [{ samples: 160, confidence: 144 }],
    );

    assert.deepEqual(
      await rows(`
      SELECT subject, bool_and(is_offered) AS is_offered
      FROM read_parquet('${courseRankings}')
      WHERE subject IN ('COMP', 'HIST')
      GROUP BY subject
      ORDER BY subject
    `),
      [
        { subject: "COMP", is_offered: true },
        { subject: "HIST", is_offered: false },
      ],
    );

    assert.deepEqual(
      await rows(`
      SELECT name, bool_and(is_teaching) AS is_teaching
      FROM read_parquet('${instructorRankings}')
      WHERE name IN ('ALPHA, Alice Beatrice', 'Dora Delta')
      GROUP BY name
      ORDER BY name
    `),
      [
        { name: "ALPHA, Alice Beatrice", is_teaching: true },
        { name: "Dora Delta", is_teaching: false },
      ],
    );

    const frontendOrder = await rows(`
      SELECT code, bayesian
      FROM read_parquet('${courseRatings}')
      WHERE subject = 'COMP' AND criterion = 'course'
        AND term_num = 100
      ORDER BY bayesian DESC, code
    `);
    assert.deepEqual(
      frontendOrder.map((row) => row.code),
      ["1000", "2000"],
    );

    // The schedule spelling is preferred when review and SFQ aliases cluster.
    assert.deepEqual(
      await rows(`
      SELECT
        bool_or(criterion = 'content') AS has_review,
        bool_or(criterion = 'instructor') AS has_sfq
      FROM read_parquet('${instructorRatings}')
      WHERE name = 'ALPHA, Alice Beatrice'
    `),
      [{ has_review: true, has_sfq: true }],
    );

    // The SFQ initials alias would match the higher-priority schedule name,
    // but they occur together in one SFQ section and must remain separate.
    const ambiguousAssignments = await rows(`
      SELECT name
      FROM read_parquet('${courseInstructors}')
      WHERE subject = 'COMP' AND code = '1000' AND term_num = 100
        AND name IN ('DELTA, A B', 'Adam Blake DELTA')
      ORDER BY name
    `);
    assert.deepEqual(
      ambiguousAssignments.map((row) => row.name),
      ["Adam Blake DELTA", "DELTA, A B"],
    );

    const reversedNameAssignments = await rows(`
      SELECT name
      FROM read_parquet('${courseInstructors}')
      WHERE subject = 'COMP' AND code = '1000' AND term_num = 100
        AND name IN ('WANG, Wei', 'WEI, Wang')
      ORDER BY name
    `);
    assert.deepEqual(
      reversedNameAssignments.map((row) => row.name),
      ["WANG, Wei", "WEI, Wang"],
    );

    assert.deepEqual(
      await rows(`
      SELECT count(*)::INTEGER AS count
      FROM read_parquet('${courseInstructors}')
      WHERE lower(name) = 'tba'
    `),
      [{ count: 0 }],
    );

    assert.deepEqual(
      await rows(`
      SELECT count(*)::INTEGER AS count
      FROM read_parquet('${courseInstructors}')
      WHERE lower(name) LIKE '%program%'
    `),
      [{ count: 0 }],
    );

    // Compare decoded schemas and ordered rows. Parquet container metadata may
    // legitimately differ even when two builds represent identical relations.
    for (const name of Object.keys(
      outputColumns,
    ) as (keyof typeof outputColumns)[]) {
      assert.deepEqual(
        await snapshot(first, name),
        await snapshot(second, name),
        `${name}.parquet is not logically reproducible`,
      );
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

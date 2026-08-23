import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureCommit = "0123456789abcdef0123456789abcdef01234567";

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

async function makeFixtures(
  dataDir: string,
  { conflictingCatalog = false, sameName = false, extraSameName = false } = {},
): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    await copyQuery(
      connection,
      join(dataDir, "schedule", "courses.parquet"),
      `
      SELECT * FROM (VALUES
        (100, 'high', TIMESTAMP '2025-01-01', 'ACTIVE', 'COMP', '1000', '2510'),
        (100, 'low',  TIMESTAMP '2025-01-01', 'ACTIVE', 'COMP', '2000', '2510'),
        (100, 'prior', TIMESTAMP '2025-01-01', 'ACTIVE', 'COMP', '3000', '2510')
      ) AS courses(term_num, id, "timestamp", status, prefix, number, term_code)
    `,
    );

    await copyQuery(
      connection,
      join(dataDir, "catalog", "courses.parquet"),
      `
      SELECT * FROM (VALUES
        ('catalog-main', 100, '2510', 'MAIN', 'COMP', '1000', 'Old title',
          [{'label': 'CC25', 'value': 'S&T', 'description': 'Science and Technology'}],
          TIMESTAMPTZ '2025-01-01 00:00:00+00', 'ACTIVE'),
        ('catalog-main', 100, '2510', 'MAIN', 'COMP', '1000', 'Foundations of Computing',
          [{'label': 'CC25', 'value': 'S&T', 'description': 'Science and Technology'}],
          TIMESTAMPTZ '2025-02-01 00:00:00+00', 'ACTIVE'),
        ('catalog-gz', 100, '2510', 'GZ', 'COMP', '1000',
          '${conflictingCatalog ? "Conflicting title" : "Foundations of Computing"}',
          [{'label': 'CC25', 'value': 'S&T', 'description': 'Science and Technology'}],
          TIMESTAMPTZ '2025-02-01 00:00:00+00', 'ACTIVE'),
        ('catalog-removed', 100, '2510', 'MAIN', 'GONE', '9999', 'Removed course', [],
          TIMESTAMPTZ '2025-01-01 00:00:00+00', 'ACTIVE'),
        ('catalog-removed', 100, '2510', 'MAIN', 'GONE', '9999', 'Removed course', [],
          TIMESTAMPTZ '2025-02-01 00:00:00+00', 'INACTIVE'),
        ('catalog-prior', 99, '2440', 'MAIN', 'HIST', '1000', 'Historical course', [],
          TIMESTAMPTZ '2024-01-01 00:00:00+00', 'ACTIVE')
      ) AS catalog(
        id, term_num, term_code, campus_code, prefix, number, title, attributes,
        "timestamp", status
      )
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
            ${sameName ? ", 'Alex Lee'" : ""}
          ]}], 'high', 'E', 'LEC'),
        (100, 'class-low', TIMESTAMP '2025-01-01', 'ACTIVE',
          [{'instructors': ['Cara Gamma'${sameName ? ", 'Alex Lee'" : ""}]}], 'low', 'E', 'LEC'),
        (100, 'class-prior', TIMESTAMP '2025-01-01', 'ACTIVE',
          [{'instructors': ['Eve Epsilon'${extraSameName ? ", 'Alex Lee'" : ""}]}], 'prior', 'E', 'LEC')
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
        ${
          sameName
            ? `,('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '1000', 'L1', 'Alex Lee', 40,
          100, false, 0.8, 4.8, 0.2, 4.8, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'same-high'),
        ('v1', 100, '2510', 'SENG', 'CSE', 'COMP', '2000', 'L1', 'Alex Lee', 41,
          100, false, 0.8, 1.2, 0.2, 1.2, 0.2, DATE '2025-01-01', TIMESTAMP '2025-01-01', 'ACTIVE', 'same-low')`
            : ""
        }
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

async function makePreviousGeneration(
  directory: string,
  omittedName?: string,
  sharedIdentityNames?: readonly [string, string],
  sameName?: "resolved" | "ambiguous" | "merged" | "wildcard",
  itscByName: Readonly<Record<string, string>> = {},
): Promise<string> {
  const names = [
    "ALPHA, Alice Beatrice",
    "Adam Blake DELTA",
    "Cara Gamma",
    "DELTA, A B",
    "Dora Delta",
    "Eve Epsilon",
    "WANG, Wei",
    "WEI, Wang",
  ];
  const rows = names
    .filter((name) => name !== omittedName)
    .map((name, index) => ({
      name,
      uuid: `00000000-0000-4000-8000-${String(
        sharedIdentityNames?.[1] === name
          ? names.indexOf(sharedIdentityNames[0]) + 1
          : index + 1,
      ).padStart(12, "0")}`,
    }));
  if (sameName) {
    rows.push(
      {
        name: "Alex Lee",
        uuid: "00000000-0000-4000-8000-000000000091",
      },
      {
        name: "Alex Lee",
        uuid: "00000000-0000-4000-8000-000000000092",
      },
    );
  }
  const values = rows
    .map(({ name, uuid }) => {
      const itsc = itscByName[name];
      return `('${uuid}', '${name.replaceAll("'", "''")}', ${itsc ? `'${itsc.replaceAll("'", "''")}'` : "NULL::VARCHAR"})`;
    })
    .join(",");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const empty =
      "SELECT ''::VARCHAR AS uuid, ''::VARCHAR AS canonical_name, NULL::VARCHAR AS itsc WHERE false";
    await copyQuery(
      connection,
      join(directory, "instructor-identities.parquet"),
      values
        ? `SELECT * FROM (VALUES ${values}) AS identities(uuid, canonical_name, itsc)`
        : empty,
    );
    await copyQuery(
      connection,
      join(directory, "instructor-aliases.parquet"),
      `SELECT uuid, canonical_name AS name, 'fixture' AS source, '${fixtureCommit}' AS source_commit, NULL::VARCHAR AS source_file FROM read_parquet('${parquet(directory, "instructor-identities")}')`,
    );
    await copyQuery(
      connection,
      join(directory, "instructor-identity-events.parquet"),
      sameName === "resolved" || sameName === "wildcard"
        ? `SELECT 'split' AS event_type, '${fixtureCommit}' AS source_commit, NULL::VARCHAR AS uuid, NULL::VARCHAR AS itsc, NULL::VARCHAR AS retired_uuid, NULL::VARCHAR AS survivor_uuid, '00000000-0000-4000-8000-000000000091' AS source_uuid, '00000000-0000-4000-8000-000000000092' AS new_uuid`
        : sameName === "merged"
          ? `SELECT 'merge' AS event_type, '${fixtureCommit}' AS source_commit, NULL::VARCHAR AS uuid, NULL::VARCHAR AS itsc, '00000000-0000-4000-8000-000000000092' AS retired_uuid, '00000000-0000-4000-8000-000000000091' AS survivor_uuid, NULL::VARCHAR AS source_uuid, NULL::VARCHAR AS new_uuid`
          : "SELECT NULL::VARCHAR AS event_type, NULL::VARCHAR AS source_commit, NULL::VARCHAR AS uuid, NULL::VARCHAR AS itsc, NULL::VARCHAR AS retired_uuid, NULL::VARCHAR AS survivor_uuid, NULL::VARCHAR AS source_uuid, NULL::VARCHAR AS new_uuid WHERE false",
    );
    await copyQuery(
      connection,
      join(directory, "instructor-split-affected-associations.parquet"),
      sameName === "resolved"
        ? `SELECT '${fixtureCommit}' AS source_commit, '00000000-0000-4000-8000-000000000092' AS new_uuid, 'Alex Lee' AS source_name, '2510' AS term_code, 'COMP 2000' AS course_code`
        : sameName === "wildcard"
          ? `SELECT '${fixtureCommit}' AS source_commit, '00000000-0000-4000-8000-000000000092' AS new_uuid, 'Alex Lee' AS source_name, NULL::VARCHAR AS term_code, NULL::VARCHAR AS course_code`
          : "SELECT NULL::VARCHAR AS source_commit, NULL::VARCHAR AS new_uuid, NULL::VARCHAR AS source_name, NULL::VARCHAR AS term_code, NULL::VARCHAR AS course_code WHERE false",
    );
    if (sameName === "resolved")
      await copyQuery(
        connection,
        join(directory, "course-instructors.parquet"),
        "SELECT '00000000-0000-4000-8000-000000000091' AS uuid, 'Alex Lee' AS name, 100 AS term_num, '2510' AS term_code, 'COMP' AS subject, '1000' AS code",
      );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  return directory;
}

function runPipeline(
  dataDir: string,
  runDir: string,
  extraEnv: Record<string, string> = {},
): string {
  const outputDir = join(runDir, "out");
  const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      RANKINGS_OUTPUT_DIR: outputDir,
      ...extraEnv,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
    "uuid",
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
    "uuid",
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
  "course-instructors": [
    "uuid",
    "name",
    "term_num",
    "term_code",
    "subject",
    "code",
  ],
  courses: ["prefix", "number", "title", "attributes"],
} as const;

async function snapshot(outputDir: string, name: keyof typeof outputColumns) {
  const path = parquet(outputDir, name);
  const schema = await rows(`DESCRIBE SELECT * FROM read_parquet('${path}')`);
  const data = await rows(`SELECT * FROM read_parquet('${path}') ORDER BY ALL`);
  return { schema, data };
}

test("DuckDB pipeline writes reproducible relational marts", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(join(temp, "previous"));

    const first = runPipeline(dataDir, join(temp, "first"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
    });
    const second = runPipeline(dataDir, join(temp, "second"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: first,
    });
    const courseRatings = parquet(first, "course-ratings");
    const instructorRatings = parquet(first, "instructor-ratings");
    const courseRankings = parquet(first, "course-rankings");
    const instructorRankings = parquet(first, "instructor-rankings");
    const courseInstructors = parquet(first, "course-instructors");
    const courses = parquet(first, "courses");

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
      SELECT prefix, number, title, attributes
      FROM read_parquet('${courses}')
      ORDER BY prefix, number
    `),
      [
        {
          prefix: "COMP",
          number: "1000",
          title: "Foundations of Computing",
          attributes: [
            {
              label: "CC25",
              value: "S&T",
              description: "Science and Technology",
            },
          ],
        },
      ],
    );

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
      ["1000", "3000", "2000"],
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

test("Instructor UUIDs are stable across pipeline runs and omit TBA", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(join(temp, "previous"));
    const first = runPipeline(dataDir, join(temp, "first"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
    });
    const second = runPipeline(dataDir, join(temp, "second"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: first,
    });
    const identities = parquet(first, "instructor-identities");
    const aliases = parquet(first, "instructor-aliases");
    const firstIds = await rows(
      `SELECT canonical_name, uuid FROM read_parquet('${identities}') ORDER BY canonical_name`,
    );
    const secondIds = await rows(
      `SELECT canonical_name, uuid FROM read_parquet('${parquet(second, "instructor-identities")}') ORDER BY canonical_name`,
    );
    assert.ok(firstIds.length > 0, "identities.parquet is empty");
    assert.deepEqual(firstIds, secondIds);
    assert.deepEqual(
      await rows(
        `SELECT count(*)::INTEGER AS count FROM read_parquet('${identities}') WHERE lower(canonical_name) = 'tba'`,
      ),
      [{ count: 0 }],
    );
    assert.deepEqual(
      await rows(
        `SELECT count(*)::INTEGER AS count FROM read_parquet('${aliases}') WHERE lower(name) = 'tba'`,
      ),
      [{ count: 0 }],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("merge corrections preserve aliases, ITSC history, and apply only once", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-merge-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      undefined,
      undefined,
      undefined,
      { "Dora Delta": "dora" },
    );
    const corrections = join(temp, "corrections.json");
    await writeFile(
      corrections,
      JSON.stringify({
        events: [
          {
            type: "merge",
            retiredUuid: "00000000-0000-4000-8000-000000000005",
            survivorUuid: "00000000-0000-4000-8000-000000000003",
            sourceCommit: "0123456789abcdef0123456789abcdef01234567",
          },
        ],
      }),
    );
    const first = runPipeline(dataDir, join(temp, "first"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      RANKINGS_INSTRUCTOR_REGISTRY_FILE: corrections,
    });
    const second = runPipeline(dataDir, join(temp, "second"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: first,
      RANKINGS_INSTRUCTOR_REGISTRY_FILE: corrections,
    });

    assert.deepEqual(
      await rows(`
        SELECT DISTINCT uuid
        FROM read_parquet('${parquet(second, "course-instructors")}')
        WHERE name IN ('Cara Gamma', 'Dora Delta')
      `),
      [{ uuid: "00000000-0000-4000-8000-000000000003" }],
    );
    assert.deepEqual(
      await rows(`
        SELECT count(*)::INTEGER AS count
        FROM read_parquet('${parquet(second, "instructor-identity-events")}')
        WHERE event_type = 'merge'
      `),
      [{ count: 1 }],
    );
    assert.deepEqual(
      await rows(`
        SELECT name
        FROM read_parquet('${parquet(second, "instructor-aliases")}')
        WHERE uuid = '00000000-0000-4000-8000-000000000003'
          AND name IN ('Cara Gamma', 'Dora Delta')
        ORDER BY name
      `),
      [{ name: "Cara Gamma" }, { name: "Dora Delta" }],
    );
    assert.deepEqual(
      await rows(`
        SELECT itsc
        FROM read_parquet('${parquet(second, "instructor-identities")}')
        WHERE uuid = '00000000-0000-4000-8000-000000000005'
      `),
      [{ itsc: "dora" }],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("split corrections preserve their identity and association once", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-split-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(join(temp, "previous"));
    const corrections = join(temp, "corrections.json");
    const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
    const newUuid = "00000000-0000-4000-8000-000000000099";
    await writeFile(
      corrections,
      JSON.stringify({
        events: [
          {
            type: "split",
            sourceUuid: "00000000-0000-4000-8000-000000000003",
            newUuid,
            sourceCommit,
            newIdentity: {
              uuid: newUuid,
              canonicalName: "Cara Gamma",
              aliases: [
                {
                  name: "Cara Gamma",
                  source: "ranking-generation",
                  sourceCommit,
                  sourceFile: "instructor-ratings.parquet",
                },
              ],
            },
            affectedAssociations: [
              {
                sourceName: "Cara Gamma",
                termCode: "2510",
                courseCode: "COMP 2000",
              },
            ],
          },
        ],
      }),
    );
    const first = runPipeline(dataDir, join(temp, "first"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      RANKINGS_INSTRUCTOR_REGISTRY_FILE: corrections,
    });
    const second = runPipeline(dataDir, join(temp, "second"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: first,
      RANKINGS_INSTRUCTOR_REGISTRY_FILE: corrections,
    });

    assert.deepEqual(
      await rows(`
        SELECT DISTINCT uuid
        FROM read_parquet('${parquet(second, "course-instructors")}')
        WHERE name = 'Cara Gamma'
      `),
      [{ uuid: newUuid }],
    );
    assert.deepEqual(
      await rows(`
        SELECT
          (SELECT count(*) FROM read_parquet('${parquet(second, "instructor-identity-events")}') WHERE event_type = 'split')::INTEGER AS events,
          (SELECT count(*) FROM read_parquet('${parquet(second, "instructor-split-affected-associations")}'))::INTEGER AS associations,
          (SELECT count(*) FROM read_parquet('${parquet(second, "instructor-split-affected-associations")}') WHERE correction_type = 'split' AND target_uuid = '${newUuid}')::INTEGER AS typed_split,
          (SELECT count(*) FROM read_parquet('${parquet(second, "instructor-aliases")}') WHERE uuid = '${newUuid}')::INTEGER AS aliases
      `),
      [{ events: 1, associations: 1, typed_split: 1, aliases: 1 }],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("association calibrations reassign names within Course scopes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-calibration-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(join(temp, "previous"));
    const corrections = join(temp, "corrections.json");
    await writeFile(
      corrections,
      JSON.stringify({
        calibrations: [
          {
            sourceName: "Cara Gamma",
            courseCode: "COMP 2000",
            instructorUuid: "00000000-0000-4000-8000-000000000006",
            sourceCommit: "0123456789abcdef0123456789abcdef01234567",
          },
          {
            sourceName: "Alice Beatrice ALPHA",
            courseCode: "COMP 1000",
            termCode: "2510",
            instructorUuid: "00000000-0000-4000-8000-000000000006",
            sourceCommit: "0123456789abcdef0123456789abcdef01234567",
          },
        ],
      }),
    );
    const first = runPipeline(dataDir, join(temp, "first"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      RANKINGS_INSTRUCTOR_REGISTRY_FILE: corrections,
    });
    const second = runPipeline(dataDir, join(temp, "second"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: first,
    });

    assert.deepEqual(
      await rows(`
        SELECT DISTINCT code, uuid, name
        FROM read_parquet('${parquet(second, "course-instructors")}')
        WHERE subject = 'COMP' AND code IN ('1000', '2000')
          AND uuid IN (
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000003',
            '00000000-0000-4000-8000-000000000006'
          )
        ORDER BY code
      `),
      [
        {
          code: "1000",
          uuid: "00000000-0000-4000-8000-000000000006",
          name: "Eve Epsilon",
        },
        {
          code: "2000",
          uuid: "00000000-0000-4000-8000-000000000006",
          name: "Eve Epsilon",
        },
      ],
    );
    assert.deepEqual(
      await rows(`
        SELECT count(DISTINCT lower(name))::INTEGER AS count
        FROM read_parquet('${parquet(second, "instructor-aliases")}')
        WHERE uuid = '00000000-0000-4000-8000-000000000006'
          AND lower(name) IN (
            'alpha, alice beatrice',
            'alice beatrice alpha',
            'cara gamma'
          )
      `),
      [{ count: 3 }],
    );
    assert.deepEqual(
      await rows(`
        SELECT correction_type, target_uuid, term_code, course_code
        FROM read_parquet('${parquet(second, "instructor-split-affected-associations")}')
        ORDER BY correction_type, target_uuid, term_code NULLS LAST
      `),
      [
        {
          correction_type: "calibration",
          target_uuid: "00000000-0000-4000-8000-000000000006",
          term_code: "2510",
          course_code: "COMP 1000",
        },
        {
          correction_type: "calibration",
          target_uuid: "00000000-0000-4000-8000-000000000006",
          term_code: null,
          course_code: "COMP 2000",
        },
      ],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("same-name Instructors stay distinct when split history identifies their associations", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-same-name-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir, { sameName: true });
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      undefined,
      undefined,
      "resolved",
    );
    const output = runPipeline(dataDir, join(temp, "out"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
    });

    assert.deepEqual(
      await rows(`
        SELECT uuid, code
        FROM read_parquet('${parquet(output, "course-instructors")}')
        WHERE name = 'Alex Lee'
        ORDER BY code
      `),
      [
        {
          uuid: "00000000-0000-4000-8000-000000000091",
          code: "1000",
        },
        {
          uuid: "00000000-0000-4000-8000-000000000092",
          code: "2000",
        },
      ],
    );
    assert.deepEqual(
      await rows(`
        SELECT
          max(bayesian) FILTER (
            WHERE uuid = '00000000-0000-4000-8000-000000000091'
          ) > max(bayesian) FILTER (
            WHERE uuid = '00000000-0000-4000-8000-000000000092'
          ) AS evidence_stays_distinct
        FROM read_parquet('${parquet(output, "instructor-ratings")}')
        WHERE name = 'Alex Lee' AND criterion = 'instructor'
      `),
      [{ evidence_stays_distinct: true }],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("same-name merge history resolves new associations to the survivor UUID", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-same-name-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir, { sameName: true });
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      undefined,
      undefined,
      "merged",
    );
    const output = runPipeline(dataDir, join(temp, "out"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
    });
    assert.deepEqual(
      await rows(`
        SELECT DISTINCT uuid
        FROM read_parquet('${parquet(output, "course-instructors")}')
        WHERE name = 'Alex Lee'
      `),
      [{ uuid: "00000000-0000-4000-8000-000000000091" }],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("new same-name associations fail closed without durable evidence", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-same-name-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir, { sameName: true, extraSameName: true });
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      undefined,
      undefined,
      "resolved",
    );
    const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        RANKINGS_OUTPUT_DIR: join(temp, "out"),
        RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /Ambiguous Instructor/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("name-only split evidence does not assign same-name Instructor UUIDs", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-same-name-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir, { sameName: true });
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      undefined,
      undefined,
      "wildcard",
    );
    const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        RANKINGS_OUTPUT_DIR: join(temp, "out"),
        RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stderr}${result.stdout}`,
      /Invalid Instructor association correction/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("same-name Instructors fail closed without distinguishing history", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-same-name-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir, { sameName: true });
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      undefined,
      undefined,
      "ambiguous",
    );
    const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        RANKINGS_OUTPUT_DIR: join(temp, "out"),
        RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /Ambiguous Instructor/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("zero-sample teaching Instructors and offered Courses receive the evidence-only prior", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-prior-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(join(temp, "previous"));
    const output = runPipeline(dataDir, join(temp, "out"), {
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
    });
    const instructorRatings = parquet(output, "instructor-ratings");
    const courseRatings = parquet(output, "course-ratings");
    assert.deepEqual(
      await rows(`
      SELECT samples::INTEGER AS samples
      FROM read_parquet('${instructorRatings}')
      WHERE name = 'Eve Epsilon' AND term_num = 100 AND criterion = 'instructor'
    `),
      [{ samples: 0 }],
    );
    assert.deepEqual(
      await rows(`
      SELECT samples::INTEGER AS samples
      FROM read_parquet('${courseRatings}')
      WHERE subject = 'COMP' AND code = '3000' AND term_num = 100
        AND criterion = 'course'
    `),
      [{ samples: 0 }],
    );
    const evidenceMean = await rows(`
      SELECT round(sum(confidence * rating) / sum(confidence), 8) AS mean
      FROM read_parquet('${instructorRatings}')
      WHERE confidence > 0 AND term_num = 100 AND criterion = 'instructor'
    `);
    assert.deepEqual(
      await rows(`
      SELECT round(bayesian, 8) AS bayesian
      FROM read_parquet('${instructorRatings}')
      WHERE name = 'Eve Epsilon' AND term_num = 100 AND criterion = 'instructor'
    `),
      [{ bayesian: evidenceMean[0]?.mean }],
    );
    assert.deepEqual(
      await rows(`
      SELECT count(*)::INTEGER AS count
      FROM read_parquet('${instructorRatings}')
      WHERE lower(name) = 'tba'
    `),
      [{ count: 0 }],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the pipeline rejects conflicting cross-campus Course metadata", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-catalog-conflict-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir, { conflictingCatalog: true });
    const previous = await makePreviousGeneration(join(temp, "previous"));
    const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        RANKINGS_OUTPUT_DIR: join(temp, "out"),
        RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /conflicting Course/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the pipeline rejects unmatched Instructor names", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-unmatched-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      "Cara Gamma",
    );
    const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        RANKINGS_OUTPUT_DIR: join(temp, "out"),
        RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stderr}${result.stdout}`,
      /Unmatched Instructor identity/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the pipeline rejects ambiguous Instructor identities", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-ambiguous-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(
      join(temp, "previous"),
      undefined,
      ["Cara Gamma", "Dora Delta"],
    );
    const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        RANKINGS_OUTPUT_DIR: join(temp, "out"),
        RANKINGS_PREVIOUS_GENERATION_DIR: previous,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stderr}${result.stdout}`,
      /Ambiguous Instructor identity/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("--init explicitly starts empty identity history", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-init-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const previous = await makePreviousGeneration(join(temp, "previous"));
    await Promise.all([
      rm(join(previous, "instructor-identity-events.parquet")),
      rm(join(previous, "instructor-split-affected-associations.parquet")),
    ]);
    const env = {
      ...process.env,
      DATA_DIR: dataDir,
      RANKINGS_OUTPUT_DIR: join(temp, "out"),
      RANKINGS_PREVIOUS_GENERATION_DIR: previous,
    };
    const rejected = spawnSync(
      process.execPath,
      [join(root, "src", "run.ts")],
      { cwd: root, encoding: "utf8", env },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(`${rejected.stderr}${rejected.stdout}`, /identity artifact/i);

    const initialized = spawnSync(
      process.execPath,
      [join(root, "src", "run.ts"), "--init"],
      { cwd: root, encoding: "utf8", env },
    );
    assert.equal(
      initialized.status,
      0,
      initialized.stderr || initialized.stdout,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the pipeline fails when previous identities are required but missing", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ust-data-identity-fail-"));
  try {
    const dataDir = join(temp, "data");
    await makeFixtures(dataDir);
    const outputDir = join(temp, "out");
    const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        RANKINGS_OUTPUT_DIR: outputDir,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stderr}${result.stdout}`,
      /previous Instructor identities/i,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

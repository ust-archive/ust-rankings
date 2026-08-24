import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { DuckDBInstance } from "@duckdb/node-api";
import { test } from "vitest";
import {
  buildDeliveryGeneration,
  DELIVERY_ARTIFACTS,
  SERVER_INDEX_FILENAME,
} from "../src/delivery.ts";

const rankingRevision = "1".repeat(40);
const scheduleRevision = "2".repeat(40);
const eventRevision = "3".repeat(40);
const correctionRevision = "4".repeat(40);
const alphaUuid = "00000000-0000-4000-8000-000000000001";
const betaUuid = "00000000-0000-4000-8000-000000000002";

async function copy(
  connection: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  path: string,
  query: string,
) {
  await connection.run("SET VARIABLE delivery_fixture_output = $path", {
    path: path.replaceAll("\\", "/"),
  });
  await connection.run(
    `COPY (${query}) TO (getvariable('delivery_fixture_output')) (FORMAT parquet)`,
  );
}

async function makeArchiveFixtures(root: string) {
  const rankingDirectory = join(root, "ranking");
  const scheduleDirectory = join(root, "schedule");
  await mkdir(rankingDirectory, { recursive: true });
  await mkdir(scheduleDirectory, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const rankingPath = (name: string) => join(rankingDirectory, name);
  const schedulePath = (name: string) => join(scheduleDirectory, name);
  try {
    await copy(
      connection,
      rankingPath("courses.parquet"),
      `SELECT * FROM (VALUES
        ('COMP', '1000', 'Computing One', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[]),
        ('COMP', '2000', 'Computing Two', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[])
      ) AS t(prefix, number, title, attributes)`,
    );
    const ratingColumns = `
      term_num, term_code, is_offered, criterion, rating, bayesian,
      confidence, samples, cumulative_samples, effective_samples,
      reliability, posterior_stddev`;
    await copy(
      connection,
      rankingPath("course-ratings.parquet"),
      `SELECT * FROM (VALUES
        ('COMP', '1000', 100, '2510', true, 'content', 4.0, 4.0, 1.0, 2::BIGINT, 2::BIGINT, 2.0, 0.8, 0.1),
        ('COMP', '2000', 100, '2510', true, 'content', 3.0, 3.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.7, 0.2),
        ('HIST', '3000', 99, '2430', false, 'content', 2.0, 2.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.6, 0.3)
      ) AS t(subject, code, ${ratingColumns})`,
    );
    await copy(
      connection,
      rankingPath("instructor-ratings.parquet"),
      `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alpha Instructor', 100, '2510', true, 'instructor', 4.0, 4.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.8, 0.1),
        ('${betaUuid}', 'Beta Instructor', 100, '2510', true, 'instructor', 3.0, 3.0, 1.0, 1::BIGINT, 1::BIGINT, 1.0, 0.7, 0.2)
      ) AS t(uuid, name, term_num, term_code, is_teaching, criterion, rating, bayesian,
        confidence, samples, cumulative_samples, effective_samples, reliability, posterior_stddev)`,
    );
    await copy(
      connection,
      rankingPath("course-instructors.parquet"),
      `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alpha Instructor', 100, '2510', 'COMP', '1000'),
        ('${betaUuid}', 'Beta Instructor', 100, '2510', 'COMP', '1000'),
        ('${betaUuid}', 'Beta Instructor', 100, '2510', 'COMP', '2000')
      ) AS t(uuid, name, term_num, term_code, subject, code)`,
    );
    await copy(
      connection,
      rankingPath("instructor-identities.parquet"),
      `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alpha Instructor', NULL::VARCHAR),
        ('${betaUuid}', 'Beta Instructor', 'beta'::VARCHAR)
      ) AS t(uuid, canonical_name, itsc)`,
    );
    await copy(
      connection,
      rankingPath("instructor-aliases.parquet"),
      `SELECT * FROM (VALUES
        ('${alphaUuid}', 'Alias Alpha', 'schedule', '${eventRevision}', NULL::VARCHAR),
        ('${betaUuid}', 'Beta Instructor', 'schedule', '${eventRevision}', NULL::VARCHAR)
      ) AS t(uuid, name, source, source_commit, source_file)`,
    );
    await copy(
      connection,
      rankingPath("instructor-identity-events.parquet"),
      `SELECT * FROM (VALUES
        ('merge', '${eventRevision}', NULL::VARCHAR, NULL::VARCHAR,
          '${alphaUuid}', '${betaUuid}', NULL::VARCHAR, NULL::VARCHAR)
      ) AS t(event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid)`,
    );
    await copy(
      connection,
      rankingPath("instructor-split-affected-associations.parquet"),
      `SELECT * FROM (VALUES
        ('calibration', '${correctionRevision}', '${betaUuid}', 'Calibrated Name', '2510', 'COMP 2000')
      ) AS t(correction_type, source_commit, target_uuid, source_name, term_code, course_code)`,
    );

    const courseColumns = `
      term_num, term_code, term_name, id, prefix, number, career, title,
      description, credits, previous, prerequisite, corequisite, exclusion,
      attributes, status, timestamp`;
    await copy(
      connection,
      schedulePath("courses.parquet"),
      `SELECT * FROM (VALUES
        (100, '2510', '2025-26 Fall', 'c1', 'COMP', '1000', 'UGRD', 'Computing One', 'One', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'INACTIVE', TIMESTAMPTZ '2025-01-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c1', 'COMP', '1000', 'UGRD', 'Computing One', 'One', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c2', 'COMP', '2000', 'UGRD', 'Computing Two', 'Two', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c3', 'SCHED', '4000', 'UGRD', 'Schedule Only', 'Schedule', 3.0, '', '', '', '', []::STRUCT(label VARCHAR, value VARCHAR, description VARCHAR)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00')
      ) AS t(${courseColumns})`,
    );
    const classColumns = `
      term_num, term_code, term_name, course_id, section, number, role, type,
      association, remarks, capacity, enroll, wait, consent, open, schedules,
      reservations, status, timestamp`;
    const alphaMeeting = `[{weekday:'Mon', date_from:NULL::DATE, date_to:NULL::DATE, time_from:NULL::TIME, time_to:NULL::TIME, venue:'R101', venue_name:'Room 101', instructors:['Alias Alpha']}]`;
    const calibratedMeeting = `[{weekday:'Tue', date_from:NULL::DATE, date_to:NULL::DATE, time_from:NULL::TIME, time_to:NULL::TIME, venue:'R102', venue_name:'Room 102', instructors:['Calibrated Name', 'Unknown Name']}]`;
    await copy(
      connection,
      schedulePath("classes.parquet"),
      `SELECT * FROM (VALUES
        (100, '2510', '2025-26 Fall', 'c1', 'L1', 1001, 'E', 'LEC', 1, '', 40, 20, 0, false, true, ${alphaMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00'),
        (100, '2510', '2025-26 Fall', 'c2', 'L1', 1002, 'E', 'LEC', 1, '', 40, 20, 0, false, true, ${calibratedMeeting}, []::STRUCT(name VARCHAR, quota INTEGER, enroll INTEGER)[], 'ACTIVE', TIMESTAMPTZ '2025-02-01 00:00:00+00')
      ) AS t(${classColumns})`,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  await writeFile(
    join(scheduleDirectory, "manifest.json"),
    `${JSON.stringify({ schemaMajor: 0, sourceCommit: scheduleRevision })}\n`,
  );
  return { rankingDirectory, scheduleDirectory };
}

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function describe(
  path: string,
): Promise<Array<{ column_name: string; column_type: string }>> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      `DESCRIBE SELECT * FROM read_parquet('${path.replaceAll("\\", "/")}')`,
    );
    return result.getRowObjectsJS() as Array<{
      column_name: string;
      column_type: string;
    }>;
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function rows(
  path: string,
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      query.replaceAll("$PATH", path.replaceAll("\\", "/")),
    );
    return result.getRowObjectsJS() as Array<Record<string, unknown>>;
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

const expectedColumns: Record<string, string[]> = {
  "course-ratings.parquet": [
    "subject",
    "code",
    "term_num",
    "term_code",
    "is_offered",
    "criterion",
    "bayesian",
    "confidence",
    "samples",
    "cumulative_samples",
  ],
  "courses.parquet": ["prefix", "number", "title", "attributes"],
  "instructor-aliases.parquet": [
    "uuid",
    "name",
    "source",
    "source_commit",
    "source_file",
  ],
  "instructor-identity-events.parquet": [
    "event_type",
    "source_commit",
    "uuid",
    "itsc",
    "retired_uuid",
    "survivor_uuid",
    "source_uuid",
    "new_uuid",
  ],
  "instructor-ratings.parquet": [
    "uuid",
    "term_num",
    "term_code",
    "is_teaching",
    "criterion",
    "bayesian",
    "confidence",
    "samples",
    "cumulative_samples",
  ],
  "instructor-split-associations.parquet": [
    "correction_type",
    "source_commit",
    "target_uuid",
    "source_name",
    "term_code",
    "course_code",
  ],
  "instructors.parquet": ["uuid", "canonical_name", "itsc"],
  "relation.parquet": ["uuid", "term_num", "term_code", "subject", "code"],
  "schedule-classes.parquet": [
    "term_num",
    "term_code",
    "term_name",
    "course_id",
    "section",
    "number",
    "role",
    "type",
    "association",
    "remarks",
    "capacity",
    "enroll",
    "wait",
    "consent",
    "open",
    "schedules",
    "reservations",
    "status",
    "timestamp",
  ],
  "schedule-courses.parquet": [
    "term_num",
    "term_code",
    "term_name",
    "id",
    "prefix",
    "number",
    "career",
    "title",
    "description",
    "credits",
    "previous",
    "prerequisite",
    "corequisite",
    "exclusion",
    "attributes",
    "status",
    "timestamp",
  ],
};

const expectedTypes: Record<string, string[]> = {
  "course-ratings.parquet": [
    "VARCHAR",
    "VARCHAR",
    "INTEGER",
    "VARCHAR",
    "BOOLEAN",
    "VARCHAR",
    "DOUBLE",
    "DOUBLE",
    "BIGINT",
    "BIGINT",
  ],
  "courses.parquet": [
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    'STRUCT("label" VARCHAR, "value" VARCHAR, description VARCHAR)[]',
  ],
  "instructor-aliases.parquet": [
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
  ],
  "instructor-identity-events.parquet": Array.from(
    { length: 8 },
    () => "VARCHAR",
  ),
  "instructor-ratings.parquet": [
    "VARCHAR",
    "INTEGER",
    "VARCHAR",
    "BOOLEAN",
    "VARCHAR",
    "DOUBLE",
    "DOUBLE",
    "BIGINT",
    "BIGINT",
  ],
  "instructor-split-associations.parquet": Array.from(
    { length: 6 },
    () => "VARCHAR",
  ),
  "instructors.parquet": ["VARCHAR", "VARCHAR", "VARCHAR"],
  "relation.parquet": ["VARCHAR", "INTEGER", "VARCHAR", "VARCHAR", "VARCHAR"],
  "schedule-classes.parquet": [
    "INTEGER",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "INTEGER",
    "VARCHAR",
    "VARCHAR",
    "INTEGER",
    "VARCHAR",
    "INTEGER",
    "INTEGER",
    "INTEGER",
    "BOOLEAN",
    "BOOLEAN",
    "STRUCT(weekday VARCHAR, date_from DATE, date_to DATE, time_from TIME, time_to TIME, venue VARCHAR, venue_name VARCHAR, instructors VARCHAR[])[]",
    'STRUCT("name" VARCHAR, quota INTEGER, enroll INTEGER)[]',
    "VARCHAR",
    "TIMESTAMP WITH TIME ZONE",
  ],
  "schedule-courses.parquet": [
    "INTEGER",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "DOUBLE",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    'STRUCT("label" VARCHAR, "value" VARCHAR, description VARCHAR)[]',
    "VARCHAR",
    "TIMESTAMP WITH TIME ZONE",
  ],
};

test("builds a deterministic Delivery Dataset and Server Index from pinned archives", async () => {
  const root = await mkdtemp(join(tmpdir(), "ust-delivery-"));
  try {
    const { rankingDirectory, scheduleDirectory } =
      await makeArchiveFixtures(root);
    const sourceFiles = [
      ...[
        "courses.parquet",
        "course-ratings.parquet",
        "instructor-ratings.parquet",
        "course-instructors.parquet",
        "instructor-identities.parquet",
        "instructor-aliases.parquet",
        "instructor-identity-events.parquet",
        "instructor-split-affected-associations.parquet",
      ].map((name) => join(rankingDirectory, name)),
      join(scheduleDirectory, "courses.parquet"),
      join(scheduleDirectory, "classes.parquet"),
    ];
    const before = new Map<string, string>(
      await Promise.all(
        sourceFiles.map(async (path) => [path, await digest(path)] as const),
      ),
    );
    const first = await buildDeliveryGeneration({
      rankingDirectory,
      scheduleDirectory,
      rankingRevision,
      scheduleRevision,
      outputDirectory: join(root, "first"),
    });
    const second = await buildDeliveryGeneration({
      rankingDirectory,
      scheduleDirectory,
      rankingRevision,
      scheduleRevision,
      outputDirectory: join(root, "second"),
    });
    assert.equal(first.generation, second.generation);
    assert.deepEqual(first.manifest, second.manifest);
    assert.deepEqual(
      await Promise.all(
        DELIVERY_ARTIFACTS.map(async (name) =>
          digest(join(first.directory, name)),
        ),
      ),
      await Promise.all(
        DELIVERY_ARTIFACTS.map(async (name) =>
          digest(join(second.directory, name)),
        ),
      ),
    );
    for (const [path, expected] of before)
      assert.equal(await digest(path), expected, `${path} changed`);

    assert.match(first.generation, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(first.manifest.artifacts), [
      ...DELIVERY_ARTIFACTS,
    ]);
    assert.equal(first.manifest.schemaVersion, 1);
    assert.equal(first.manifest.sources.rankings, rankingRevision);
    assert.equal(first.manifest.sources.schedule, scheduleRevision);
    for (const filename of DELIVERY_ARTIFACTS) {
      const schema = await describe(join(first.directory, filename));
      assert.deepEqual(
        schema.map((column) => column.column_name),
        expectedColumns[filename],
        `${filename} column names`,
      );
      assert.deepEqual(
        schema.map((column) => column.column_type),
        expectedTypes[filename],
        `${filename} column types`,
      );
      assert.equal(
        first.manifest.artifacts[filename]?.bytes,
        (await stat(join(first.directory, filename))).size,
      );
      assert.equal(
        first.manifest.artifacts[filename]?.sha256,
        await digest(join(first.directory, filename)),
      );
      assert.equal(
        first.manifest.artifacts[filename]?.url,
        `https://ust-rankings-data.sgp1.cdn.digitaloceanspaces.com/${first.generation}/${filename}`,
      );
    }
    const expectedRowCounts: Record<string, number> = {
      "course-ratings.parquet": 3,
      "courses.parquet": 2,
      "instructor-aliases.parquet": 2,
      "instructor-identity-events.parquet": 1,
      "instructor-ratings.parquet": 2,
      "instructor-split-associations.parquet": 1,
      "instructors.parquet": 2,
      "relation.parquet": 3,
      "schedule-classes.parquet": 2,
      "schedule-courses.parquet": 4,
    };
    for (const filename of DELIVERY_ARTIFACTS)
      assert.equal(
        (
          await rows(
            join(first.directory, filename),
            "SELECT count(*)::INTEGER AS count FROM read_parquet('$PATH')",
          )
        )[0]?.count,
        expectedRowCounts[filename],
        `${filename} row count`,
      );
    const fullCourseRatingColumns = await describe(
      join(rankingDirectory, "course-ratings.parquet"),
    );
    assert.ok(
      fullCourseRatingColumns.some((column) => column.column_name === "rating"),
    );
    const fullInstructorRatingColumns = await describe(
      join(rankingDirectory, "instructor-ratings.parquet"),
    );
    assert.ok(
      fullInstructorRatingColumns.some(
        (column) => column.column_name === "name",
      ),
    );
    assert.deepEqual(
      await rows(
        join(first.directory, "course-ratings.parquet"),
        "SELECT subject, code, bayesian FROM read_parquet('$PATH') ORDER BY subject, code",
      ),
      [
        { subject: "COMP", code: "1000", bayesian: 4 },
        { subject: "COMP", code: "2000", bayesian: 3 },
        { subject: "HIST", code: "3000", bayesian: 2 },
      ],
    );
    assert.deepEqual(
      await rows(
        join(first.directory, "instructor-ratings.parquet"),
        "SELECT uuid, bayesian FROM read_parquet('$PATH') ORDER BY uuid",
      ),
      [
        { uuid: alphaUuid, bayesian: 4 },
        { uuid: betaUuid, bayesian: 3 },
      ],
    );
    assert.deepEqual(
      await rows(
        join(first.directory, "relation.parquet"),
        "SELECT uuid, term_code, subject, code FROM read_parquet('$PATH') ORDER BY uuid, code",
      ),
      [
        { uuid: alphaUuid, term_code: "2510", subject: "COMP", code: "1000" },
        { uuid: betaUuid, term_code: "2510", subject: "COMP", code: "1000" },
        { uuid: betaUuid, term_code: "2510", subject: "COMP", code: "2000" },
      ],
    );
    assert.deepEqual(
      await rows(
        `${rankingDirectory}/course-ratings.parquet`,
        "SELECT subject, code, term_num, term_code, is_offered, criterion, bayesian, confidence, samples, cumulative_samples FROM read_parquet('$PATH') ORDER BY subject, code",
      ),
      await rows(
        join(first.directory, "course-ratings.parquet"),
        "SELECT subject, code, term_num, term_code, is_offered, criterion, bayesian, confidence, samples, cumulative_samples FROM read_parquet('$PATH') ORDER BY subject, code",
      ),
    );
    assert.deepEqual(
      await rows(
        `${rankingDirectory}/instructor-ratings.parquet`,
        "SELECT uuid, term_num, term_code, is_teaching, criterion, bayesian, confidence, samples, cumulative_samples FROM read_parquet('$PATH') ORDER BY uuid",
      ),
      await rows(
        join(first.directory, "instructor-ratings.parquet"),
        "SELECT uuid, term_num, term_code, is_teaching, criterion, bayesian, confidence, samples, cumulative_samples FROM read_parquet('$PATH') ORDER BY uuid",
      ),
    );
    assert.deepEqual(
      await rows(
        join(first.directory, "schedule-courses.parquet"),
        "SELECT term_code, prefix, number, status FROM read_parquet('$PATH') ORDER BY id, timestamp",
      ),
      [
        {
          term_code: "2510",
          prefix: "COMP",
          number: "1000",
          status: "INACTIVE",
        },
        { term_code: "2510", prefix: "COMP", number: "1000", status: "ACTIVE" },
        { term_code: "2510", prefix: "COMP", number: "2000", status: "ACTIVE" },
        {
          term_code: "2510",
          prefix: "SCHED",
          number: "4000",
          status: "ACTIVE",
        },
      ],
    );
    assert.deepEqual(
      await rows(
        join(first.directory, "schedule-classes.parquet"),
        "SELECT course_id, section, number, status FROM read_parquet('$PATH') ORDER BY course_id, section",
      ),
      [
        { course_id: "c1", section: "L1", number: 1001, status: "ACTIVE" },
        { course_id: "c2", section: "L1", number: 1002, status: "ACTIVE" },
      ],
    );

    const serverIndex = JSON.parse(
      gunzipSync(
        await readFile(join(first.directory, SERVER_INDEX_FILENAME)),
      ).toString(),
    ) as typeof first.serverIndex;
    assert.equal(serverIndex.schemaVersion, 1);
    assert.equal(serverIndex.generation, first.generation);
    assert.deepEqual(serverIndex.courses, [
      { prefix: "COMP", number: "1000" },
      { prefix: "COMP", number: "2000" },
      { prefix: "HIST", number: "3000" },
      { prefix: "SCHED", number: "4000" },
    ]);
    assert.deepEqual(serverIndex.instructorRedirects, [
      { from: alphaUuid, to: betaUuid },
    ]);
    assert.deepEqual(serverIndex.associationCorrections, [
      {
        correctionType: "calibration",
        sourceCommit: correctionRevision,
        targetUuid: betaUuid,
        sourceName: "Calibrated Name",
        termCode: "2510",
        courseCode: "COMP 2000",
      },
    ]);
    assert.deepEqual(serverIndex.courseOfferings, [
      {
        termNumber: 100,
        termCode: "2510",
        termName: "2025-26 Fall",
        courseId: "c1",
        courseCode: "COMP 1000",
      },
      {
        termNumber: 100,
        termCode: "2510",
        termName: "2025-26 Fall",
        courseId: "c2",
        courseCode: "COMP 2000",
      },
      {
        termNumber: 100,
        termCode: "2510",
        termName: "2025-26 Fall",
        courseId: "c3",
        courseCode: "SCHED 4000",
      },
    ]);
    assert.equal(serverIndex.classes.length, 2);
    assert.deepEqual(
      serverIndex.classInstructors.map(({ courseId, sourceName, uuid }) => ({
        courseId,
        sourceName,
        uuid,
      })),
      [
        { courseId: "c1", sourceName: "Alias Alpha", uuid: betaUuid },
        { courseId: "c2", sourceName: "Calibrated Name", uuid: betaUuid },
      ],
    );
    assert.equal(first.manifest.serverIndex.generation, first.generation);
    assert.equal(
      first.manifest.serverIndex.bytes,
      (await stat(join(first.directory, SERVER_INDEX_FILENAME))).size,
    );
    assert.equal(
      first.manifest.serverIndex.sha256,
      await digest(join(first.directory, SERVER_INDEX_FILENAME)),
    );
    assert.equal(Object.keys(first.manifest.artifacts).length, 10);

    const repeated = await buildDeliveryGeneration({
      rankingDirectory,
      scheduleDirectory,
      rankingRevision,
      scheduleRevision,
      outputDirectory: join(root, "first"),
    });
    assert.equal(repeated.generation, first.generation);
    await writeFile(join(first.directory, SERVER_INDEX_FILENAME), "corrupt");
    await assert.rejects(
      buildDeliveryGeneration({
        rankingDirectory,
        scheduleDirectory,
        rankingRevision,
        scheduleRevision,
        outputDirectory: join(root, "first"),
      }),
      /Delivery generation is not immutable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects mutable revisions before creating a staged generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ust-delivery-invalid-"));
  try {
    const { rankingDirectory, scheduleDirectory } =
      await makeArchiveFixtures(root);
    await assert.rejects(
      buildDeliveryGeneration({
        rankingDirectory,
        scheduleDirectory,
        rankingRevision: "main",
        scheduleRevision,
        outputDirectory: join(root, "output"),
      }),
      /Ranking revision must be an immutable 40-hex revision/,
    );
    await assert.rejects(access(join(root, "output")), /ENOENT/);

    await writeFile(
      join(scheduleDirectory, "manifest.json"),
      `${JSON.stringify({ schemaMajor: 0, sourceCommit: "f".repeat(40) })}\n`,
    );
    const output = join(root, "failed-output");
    await assert.rejects(
      buildDeliveryGeneration({
        rankingDirectory,
        scheduleDirectory,
        rankingRevision,
        scheduleRevision,
        outputDirectory: output,
      }),
      /Schedule archive manifest revision does not match its pinned revision/,
    );
    assert.deepEqual(await readdir(output), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

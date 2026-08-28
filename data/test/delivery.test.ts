import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
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
import { makeRankingArchiveFixture } from "./rankings-fixture.ts";
import { makeScheduleArchiveFixture } from "./schedule-fixture.ts";

const rankingRevision = "1".repeat(40);
const scheduleRevision = "2".repeat(40);
const eventRevision = "3".repeat(40);
const correctionRevision = "4".repeat(40);
const alphaUuid = "00000000-0000-4000-8000-000000000001";
const betaUuid = "00000000-0000-4000-8000-000000000002";
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
const scheduleInputs = [
  "courses.parquet",
  "classes.parquet",
  "canonical/class_records.parquet",
  "classes_legacy.parquet",
] as const;

async function makeArchiveFixtures(root: string) {
  const [rankingDirectory, scheduleDirectory] = await Promise.all([
    makeRankingArchiveFixture(
      join(root, "ranking"),
      rankingRevision,
      eventRevision,
      correctionRevision,
    ),
    makeScheduleArchiveFixture(join(root, "schedule"), scheduleRevision),
  ]);
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
  "waitlist-evidence.parquet": [
    "term_num",
    "term_code",
    "term_name",
    "course_code",
    "section",
    "association",
    "class_type",
    "class_number",
    "capacity",
    "enrollment",
    "waitlist",
    "consent",
    "schedules",
    "reservations",
    "observed_at",
    "source_order",
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
  "waitlist-evidence.parquet": [
    "INTEGER",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "INTEGER",
    "VARCHAR",
    "INTEGER",
    "INTEGER",
    "INTEGER",
    "INTEGER",
    "BOOLEAN",
    "VARCHAR",
    "VARCHAR",
    "TIMESTAMP WITH TIME ZONE",
    "BIGINT",
  ],
};

test("builds a deterministic Delivery Dataset and Server Index from pinned archives", async () => {
  const root = await mkdtemp(join(tmpdir(), "ust-delivery-"));
  try {
    const { rankingDirectory, scheduleDirectory } =
      await makeArchiveFixtures(root);
    const sourceFiles = [
      ...rankingInputs.map((name) => join(rankingDirectory, name)),
      ...scheduleInputs.map((name) => join(scheduleDirectory, name)),
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
    assert.deepEqual(first.manifest.waitlistEvidence, {
      artifact: "waitlist-evidence.parquet",
      schemaVersion: 1,
      modelVersion: "joint-baseline-v3",
      sourceArtifact: "canonical/class_records.parquet",
      sourceRevision: scheduleRevision,
      sourceAvailable: true,
      selectedModel: "baseline",
      priorWeight: 2,
      timing: {
        activation: "first-positive-wait",
        normalEnrollment: "official-registry",
        addDrop: "official-registry",
        sinceActivationBucketsHours: [12, 24, 48],
        sinceEnrollmentBucketDays: 2,
        untilAddDropBucketDays: 3,
      },
      tuning: {
        positions: [5, 25, 50],
        activationHours: [12, 24, 48],
        priorWeights: [0.5, 1, 2, 4, 8, 16, 32],
        holdout: "whole-term",
      },
      uncertainty: "estimated-bounded-margin-not-calibrated-interval",
      terms: [
        {
          termCode: "2410",
          season: "Fall",
          enrollmentStart: "2024-08-27T00:00:00+08:00",
          addDropEnd: "2024-09-14T23:59:00+08:00",
          source:
            "https://registry.hkust.edu.hk/calendar_dates/dates24-25confirmed.pdf",
        },
        {
          termCode: "2430",
          season: "Spring",
          enrollmentStart: "2025-01-23T00:00:00+08:00",
          addDropEnd: "2025-02-15T23:59:00+08:00",
          source:
            "https://registry.hkust.edu.hk/calendar_dates/dates24-25confirmed.pdf",
        },
        {
          termCode: "2510",
          season: "Fall",
          enrollmentStart: "2025-08-26T00:00:00+08:00",
          addDropEnd: "2025-09-13T23:59:00+08:00",
          source:
            "https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf",
        },
        {
          termCode: "2530",
          season: "Spring",
          enrollmentStart: "2026-01-27T00:00:00+08:00",
          addDropEnd: "2026-02-14T23:59:00+08:00",
          source:
            "https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf",
        },
        {
          termCode: "2610",
          season: "Fall",
          enrollmentStart: "2026-08-25T00:00:00+08:00",
          addDropEnd: "2026-09-14T23:59:00+08:00",
          source:
            "https://registry.hkust.edu.hk/calendar_dates/dates26-27confirmed.pdf",
        },
      ],
    });
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
      "courses.parquet": 3,
      "instructor-aliases.parquet": 2,
      "instructor-identity-events.parquet": 1,
      "instructor-ratings.parquet": 2,
      "instructor-split-associations.parquet": 1,
      "instructors.parquet": 2,
      "relation.parquet": 3,
      "schedule-classes.parquet": 2,
      "schedule-courses.parquet": 4,
      "waitlist-evidence.parquet": 4,
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
    assert.deepEqual(
      await rows(
        join(first.directory, "waitlist-evidence.parquet"),
        "SELECT term_code, course_code, section, association, class_type, class_number, capacity, enrollment, waitlist, source_order FROM read_parquet('$PATH') ORDER BY source_order",
      ),
      [
        {
          term_code: "2510",
          course_code: "COMP 2000",
          section: "L1",
          association: null,
          class_type: "LEC",
          class_number: 1001,
          capacity: 40,
          enrollment: 20,
          waitlist: 30,
          source_order: 1n,
        },
        {
          term_code: "2510",
          course_code: "COMP 2000",
          section: "LA1",
          association: null,
          class_type: "LAB",
          class_number: 1003,
          capacity: 20,
          enrollment: 10,
          waitlist: 12,
          source_order: 2n,
        },
        {
          term_code: "2510",
          course_code: "COMP 2000",
          section: "L1",
          association: null,
          class_type: "LEC",
          class_number: 1001,
          capacity: 40,
          enrollment: 25,
          waitlist: 10,
          source_order: 3n,
        },
        {
          term_code: "2510",
          course_code: "COMP 2000",
          section: "LA1",
          association: null,
          class_type: "LAB",
          class_number: 1003,
          capacity: 20,
          enrollment: 12,
          waitlist: 0,
          source_order: 4n,
        },
      ],
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
      { prefix: "CAT", number: "5000" },
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
    assert.equal(first.manifest.serverIndex.url, SERVER_INDEX_FILENAME);
    assert.equal(first.manifest.serverIndex.generation, first.generation);
    assert.equal(
      first.manifest.serverIndex.bytes,
      (await stat(join(first.directory, SERVER_INDEX_FILENAME))).size,
    );
    assert.equal(
      first.manifest.serverIndex.sha256,
      await digest(join(first.directory, SERVER_INDEX_FILENAME)),
    );
    assert.equal(Object.keys(first.manifest.artifacts).length, 11);

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

test("emits a schema-only Waitlist Evidence artifact when legacy history is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "ust-delivery-no-history-"));
  try {
    const { rankingDirectory, scheduleDirectory } =
      await makeArchiveFixtures(root);
    await rm(join(scheduleDirectory, "canonical/class_records.parquet"));
    await rm(join(scheduleDirectory, "classes_legacy.parquet"));
    const sourceManifestPath = join(scheduleDirectory, "manifest.json");
    const sourceManifest = JSON.parse(
      await readFile(sourceManifestPath, "utf8"),
    ) as { artifacts: Record<string, unknown> };
    delete sourceManifest.artifacts["canonical/class_records.parquet"];
    delete sourceManifest.artifacts["classes_legacy.parquet"];
    await writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest)}\n`);
    const result = await buildDeliveryGeneration({
      rankingDirectory,
      scheduleDirectory,
      rankingRevision,
      scheduleRevision,
      outputDirectory: join(root, "output"),
    });
    assert.equal(result.manifest.waitlistEvidence.sourceAvailable, false);
    assert.deepEqual(
      await rows(
        join(result.directory, "waitlist-evidence.parquet"),
        "SELECT count(*)::INTEGER AS count FROM read_parquet('$PATH')",
      ),
      [{ count: 0 }],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects mutable or unauthenticated source revisions", async () => {
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

    const rankingManifest = await readFile(
      join(rankingDirectory, "manifest.json"),
      "utf8",
    );
    await rm(join(rankingDirectory, "manifest.json"));
    await assert.rejects(
      buildDeliveryGeneration({
        rankingDirectory,
        scheduleDirectory,
        rankingRevision,
        scheduleRevision,
        outputDirectory: join(root, "missing-manifest"),
      }),
      /Ranking archive is missing manifest.json/,
    );
    await writeFile(join(rankingDirectory, "manifest.json"), rankingManifest);

    const scheduleManifest = await readFile(
      join(scheduleDirectory, "manifest.json"),
      "utf8",
    );
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

    await writeFile(join(scheduleDirectory, "manifest.json"), scheduleManifest);
    await writeFile(join(rankingDirectory, "courses.parquet"), "corrupt");
    await assert.rejects(
      buildDeliveryGeneration({
        rankingDirectory,
        scheduleDirectory,
        rankingRevision,
        scheduleRevision,
        outputDirectory: join(root, "corrupt-source"),
      }),
      /Ranking archive artifact does not match courses.parquet/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

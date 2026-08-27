import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import {
  buildInstructorIdentityHistory,
  type InstructorAssociationCorrection,
  type InstructorIdentityHistoryEvent,
} from "../../lib/instructor-identity.ts";
import {
  DELIVERY_ARTIFACTS,
  DELIVERY_CDN_BASE_URL,
  DELIVERY_SCHEMA_VERSION,
  type DeliveryArtifactDeclaration,
  type DeliveryArtifactName,
  type DeliveryManifest,
  deliveryGenerationIdentityInput,
  SERVER_INDEX_FILENAME,
  type ServerIndex,
  WAITLIST_EVIDENCE_FILENAME,
  type WaitlistEvidenceManifest,
} from "../../lib/server-index-contract.ts";
import {
  WAITLIST_MODEL_VERSION,
  WAITLIST_PRIOR_WEIGHT,
  WAITLIST_PRIOR_WEIGHTS,
  WAITLIST_TERMS,
  WAITLIST_TUNING_HOURS,
  WAITLIST_TUNING_POSITIONS,
} from "./waitlist-evidence.ts";

export {
  DELIVERY_ARTIFACTS,
  DELIVERY_CDN_BASE_URL,
  DELIVERY_SCHEMA_VERSION,
  type DeliveryArtifactDeclaration,
  type DeliveryManifest,
  SERVER_INDEX_FILENAME,
  type ServerIndex,
  WAITLIST_EVIDENCE_FILENAME,
} from "../../lib/server-index-contract.ts";

const RANKING_INPUTS = [
  "courses.parquet",
  "course-ratings.parquet",
  "instructor-ratings.parquet",
  "course-instructors.parquet",
  "instructor-identities.parquet",
  "instructor-aliases.parquet",
  "instructor-identity-events.parquet",
  "instructor-split-affected-associations.parquet",
] as const;
const SCHEDULE_INPUTS = ["courses.parquet", "classes.parquet"] as const;
const LEGACY_CLASSES_INPUT = "classes_legacy.parquet";
const REVISION_PATTERN = /^[0-9a-f]{40}$/;

export type BuildDeliveryGenerationOptions = {
  rankingDirectory: string;
  scheduleDirectory: string;
  rankingRevision: string;
  scheduleRevision: string;
  outputDirectory: string;
};

export type BuildDeliveryGenerationResult = {
  directory: string;
  generation: string;
  manifest: DeliveryManifest;
  serverIndex: ServerIndex;
};

type Row = Record<string, unknown>;

type IdentityRow = {
  uuid: string;
  canonical_name: string;
  itsc: string | null;
};

type AliasRow = {
  uuid: string;
  name: string;
  source: string;
  source_commit: string;
  source_file: string | null;
};

type EventRow = {
  event_type: string;
  source_commit: string;
  uuid: string | null;
  itsc: string | null;
  retired_uuid: string | null;
  survivor_uuid: string | null;
  source_uuid: string | null;
  new_uuid: string | null;
};

type CorrectionRow = {
  correction_type: "split" | "calibration";
  source_commit: string;
  target_uuid: string;
  source_name: string;
  term_code: string | null;
  course_code: string;
};

type RelationRow = {
  uuid: string;
  term_num: number;
  term_code: string;
  subject: string;
  code: string;
  name: string;
};

type ScheduleCourseRow = {
  term_num: number;
  term_code: string;
  term_name: string;
  id: string;
  prefix: string;
  number: string;
};

type ScheduleClassRow = {
  term_num: number;
  term_code: string;
  course_id: string;
  section: string;
  number: number;
  schedules: unknown;
  course_prefix: string;
  course_number: string;
};

function sqlPath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll("'", "''");
}

function revision(value: string, name: string): string {
  if (!REVISION_PATTERN.test(value))
    throw new Error(`${name} must be an immutable 40-hex revision`);
  return value;
}

function valueString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Invalid ${name} in archive`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function courseCode(prefix: string, number: string): string {
  return `${prefix} ${number}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readRows(
  connection: DuckDBConnection,
  query: string,
): Promise<Row[]> {
  const reader = await connection.runAndReadAll(query);
  return reader.getRowObjectsJS() as Row[];
}

async function describe(
  connection: DuckDBConnection,
  path: string,
): Promise<Array<{ name: string; type: string }>> {
  const rows = await readRows(
    connection,
    `DESCRIBE SELECT * FROM read_parquet('${sqlPath(path)}')`,
  );
  return rows.map((row) => ({
    name: valueString(row.column_name, "column name"),
    type: valueString(row.column_type, "column type"),
  }));
}

async function requireColumns(
  connection: DuckDBConnection,
  path: string,
  columns: readonly string[],
): Promise<void> {
  const actual = new Set(
    (await describe(connection, path)).map((row) => row.name),
  );
  for (const column of columns)
    if (!actual.has(column))
      throw new Error(`${path} is missing required column ${column}`);
}

async function validateSourceManifest(
  directory: string,
  expectedRevision: string,
  filenames: readonly string[],
  label: string,
): Promise<void> {
  const path = join(directory, "manifest.json");
  if (!(await fileExists(path)))
    throw new Error(`${label} is missing manifest.json`);
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    sourceCommit?: unknown;
    artifacts?: Record<
      string,
      { size?: unknown; bytes?: unknown; sha256?: unknown }
    >;
  };
  if (parsed.sourceCommit !== expectedRevision)
    throw new Error(
      `${label} manifest revision does not match its pinned revision`,
    );
  for (const filename of filenames) {
    const expected = parsed.artifacts?.[filename];
    const bytes = expected?.size ?? expected?.bytes;
    if (
      !Number.isSafeInteger(bytes) ||
      Number(bytes) <= 0 ||
      typeof expected?.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(expected.sha256)
    )
      throw new Error(`${label} manifest does not declare ${filename}`);
    const actual = await declaration(join(directory, filename));
    if (actual.bytes !== bytes || actual.sha256 !== expected.sha256)
      throw new Error(`${label} artifact does not match ${filename}`);
  }
}

async function validateInputs(
  connection: DuckDBConnection,
  options: BuildDeliveryGenerationOptions,
): Promise<void> {
  const rankingDirectory = resolve(options.rankingDirectory);
  const scheduleDirectory = resolve(options.scheduleDirectory);
  const legacyClassesPath = join(scheduleDirectory, LEGACY_CLASSES_INPUT);
  const hasLegacyClasses = await fileExists(legacyClassesPath);
  for (const filename of RANKING_INPUTS) {
    const path = join(rankingDirectory, filename);
    if (!(await fileExists(path)))
      throw new Error(`Ranking archive is missing ${filename}`);
  }
  for (const filename of SCHEDULE_INPUTS) {
    const path = join(scheduleDirectory, filename);
    if (!(await fileExists(path)))
      throw new Error(`Schedule archive is missing ${filename}`);
  }
  await validateSourceManifest(
    rankingDirectory,
    options.rankingRevision,
    RANKING_INPUTS,
    "Ranking archive",
  );
  await validateSourceManifest(
    scheduleDirectory,
    options.scheduleRevision,
    hasLegacyClasses
      ? [...SCHEDULE_INPUTS, LEGACY_CLASSES_INPUT]
      : SCHEDULE_INPUTS,
    "Schedule archive",
  );

  const rankingColumns: Record<string, readonly string[]> = {
    "courses.parquet": ["prefix", "number", "title", "attributes"],
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
    "instructor-ratings.parquet": [
      "uuid",
      "name",
      "term_num",
      "term_code",
      "is_teaching",
      "criterion",
      "bayesian",
      "confidence",
      "samples",
      "cumulative_samples",
    ],
    "course-instructors.parquet": [
      "uuid",
      "name",
      "term_num",
      "term_code",
      "subject",
      "code",
    ],
    "instructor-identities.parquet": ["uuid", "canonical_name", "itsc"],
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
    "instructor-split-affected-associations.parquet": [
      "correction_type",
      "source_commit",
      "target_uuid",
      "source_name",
      "term_code",
      "course_code",
    ],
  };
  for (const [filename, columns] of Object.entries(rankingColumns))
    await requireColumns(connection, join(rankingDirectory, filename), columns);

  const scheduleColumns: Record<string, readonly string[]> = {
    "courses.parquet": [
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
    "classes.parquet": [
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
  };
  for (const [filename, columns] of Object.entries(scheduleColumns))
    await requireColumns(
      connection,
      join(scheduleDirectory, filename),
      columns,
    );
  if (hasLegacyClasses)
    await requireColumns(connection, legacyClassesPath, [
      "term_num",
      "term_code",
      "term_name",
      "course_code",
      "section",
      "number",
      "capacity",
      "enroll",
      "wait",
      "consent",
      "schedules",
      "reservations",
      "timestamp",
      "source_order",
    ]);
}

async function copyParquet(
  connection: DuckDBConnection,
  outputPath: string,
  query: string,
): Promise<void> {
  await connection.run("SET VARIABLE delivery_output = $path", {
    path: outputPath.replaceAll("\\", "/"),
  });
  await connection.run(
    `COPY (${query}) TO (getvariable('delivery_output')) (FORMAT parquet, COMPRESSION zstd)`,
  );
}

function waitlistEvidenceMetadata(
  scheduleRevision: string,
  sourceAvailable: boolean,
): WaitlistEvidenceManifest {
  return {
    artifact: WAITLIST_EVIDENCE_FILENAME,
    schemaVersion: 1,
    modelVersion: WAITLIST_MODEL_VERSION,
    sourceArtifact: "classes_legacy.parquet",
    sourceRevision: scheduleRevision,
    sourceAvailable,
    selectedModel: "baseline",
    priorWeight: WAITLIST_PRIOR_WEIGHT,
    timing: {
      activation: "first-positive-wait",
      normalEnrollment: "official-registry",
      addDrop: "official-registry",
      sinceActivationBucketsHours: WAITLIST_TUNING_HOURS,
      sinceEnrollmentBucketDays: 2,
      untilAddDropBucketDays: 3,
    },
    tuning: {
      positions: WAITLIST_TUNING_POSITIONS,
      activationHours: WAITLIST_TUNING_HOURS,
      priorWeights: WAITLIST_PRIOR_WEIGHTS,
      holdout: "whole-term",
    },
    uncertainty: "estimated-bounded-margin-not-calibrated-interval",
    terms: Object.entries(WAITLIST_TERMS).map(([termCode, term]) => ({
      termCode,
      season: term.season,
      enrollmentStart: term.enrollmentStart,
      addDropEnd: term.addDropEnd,
      source: term.source,
    })),
  };
}

async function copyWaitlistEvidence(
  connection: DuckDBConnection,
  outputPath: string,
  scheduleDirectory: string,
): Promise<boolean> {
  const sourcePath = join(scheduleDirectory, LEGACY_CLASSES_INPUT);
  const sourceAvailable = await fileExists(sourcePath);
  const source = sqlPath(sourcePath);
  const query = sourceAvailable
    ? `SELECT term_num::INTEGER AS term_num, term_code::VARCHAR AS term_code,
        term_name::VARCHAR AS term_name,
        (regexp_extract(upper(trim(course_code)), '^[A-Z]{2,8}') || ' ' ||
          regexp_extract(upper(trim(course_code)), '[0-9].*$'))::VARCHAR AS course_code,
        section::VARCHAR AS section,
        NULL::INTEGER AS association,
        CASE
          WHEN regexp_matches(section, '^LA', 'i') THEN 'LAB'
          WHEN regexp_matches(section, '^L', 'i') THEN 'LEC'
          WHEN regexp_matches(section, '^T', 'i') THEN 'TUT'
          ELSE 'IND'
        END::VARCHAR AS class_type,
        number::INTEGER AS class_number, capacity::INTEGER AS capacity,
        enroll::INTEGER AS enrollment, greatest(wait, 0)::INTEGER AS waitlist,
        consent::BOOLEAN AS consent,
        to_json(schedules)::VARCHAR AS schedules,
        to_json(reservations)::VARCHAR AS reservations,
        timestamp::TIMESTAMPTZ AS observed_at, source_order::BIGINT AS source_order
      FROM read_parquet('${source}')
      WHERE term_code IN (${Object.keys(WAITLIST_TERMS)
        .map((term) => `'${term}'`)
        .join(", ")})
      ORDER BY term_num, course_code, section, observed_at, source_order`
    : `SELECT
        NULL::INTEGER AS term_num, NULL::VARCHAR AS term_code,
        NULL::VARCHAR AS term_name, NULL::VARCHAR AS course_code,
        NULL::VARCHAR AS section, NULL::INTEGER AS association,
        NULL::VARCHAR AS class_type, NULL::INTEGER AS class_number,
        NULL::INTEGER AS capacity,
        NULL::INTEGER AS enrollment, NULL::INTEGER AS waitlist,
        NULL::BOOLEAN AS consent, NULL::VARCHAR AS schedules, NULL::VARCHAR AS reservations,
        NULL::TIMESTAMPTZ AS observed_at, NULL::BIGINT AS source_order
      WHERE false`;
  await copyParquet(connection, outputPath, query);
  return sourceAvailable;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function declaration(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const file = await stat(path);
  if (!file.isFile() || !Number.isSafeInteger(file.size) || file.size <= 0)
    throw new Error(`Delivery artifact is empty: ${path}`);
  return { bytes: file.size, sha256: await sha256(path) };
}

function identityEvent(row: EventRow): InstructorIdentityHistoryEvent {
  const sourceCommit = valueString(
    row.source_commit,
    "identity event source commit",
  );
  switch (row.event_type) {
    case "itsc-added":
      return {
        type: "itsc-added",
        uuid: valueString(row.uuid, "ITSC event UUID"),
        itsc: valueString(row.itsc, "ITSC event ITSC"),
        sourceCommit,
      };
    case "merge":
      return {
        type: "merge",
        retiredUuid: valueString(row.retired_uuid, "merge retired UUID"),
        survivorUuid: valueString(row.survivor_uuid, "merge survivor UUID"),
        sourceCommit,
      };
    case "split":
      return {
        type: "split",
        sourceUuid: valueString(row.source_uuid, "split source UUID"),
        newUuid: valueString(row.new_uuid, "split new UUID"),
        sourceCommit,
      };
    default:
      throw new Error(`Unknown Instructor identity event: ${row.event_type}`);
  }
}

function correction(row: CorrectionRow): InstructorAssociationCorrection {
  return {
    correctionType: row.correction_type,
    sourceCommit: valueString(row.source_commit, "correction source commit"),
    targetUuid: valueString(row.target_uuid, "correction target UUID"),
    sourceName: valueString(row.source_name, "correction source name"),
    ...(row.term_code === null
      ? {}
      : { termCode: valueString(row.term_code, "correction Term Code") }),
    courseCode: valueString(row.course_code, "correction Course Code"),
  };
}

async function buildServerIndex(
  connection: DuckDBConnection,
  rankingDirectory: string,
  scheduleDirectory: string,
  rankingRevision: string,
  generation: string,
): Promise<ServerIndex> {
  const ranking = (filename: string) =>
    sqlPath(join(rankingDirectory, filename));
  const schedule = (filename: string) =>
    sqlPath(join(scheduleDirectory, filename));

  const identityRows = (await readRows(
    connection,
    `SELECT uuid, canonical_name, itsc FROM read_parquet('${ranking("instructor-identities.parquet")}') ORDER BY uuid`,
  )) as unknown as IdentityRow[];
  const aliasRows = (await readRows(
    connection,
    `SELECT uuid, name, source, source_commit, source_file FROM read_parquet('${ranking("instructor-aliases.parquet")}') ORDER BY uuid, name`,
  )) as unknown as AliasRow[];
  const eventRows = (await readRows(
    connection,
    `SELECT event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid FROM read_parquet('${ranking("instructor-identity-events.parquet")}') ORDER BY source_commit, event_type`,
  )) as unknown as EventRow[];
  const correctionRows = (await readRows(
    connection,
    `SELECT correction_type, source_commit, target_uuid, source_name, term_code, course_code FROM read_parquet('${ranking("instructor-split-affected-associations.parquet")}') ORDER BY source_commit, correction_type, target_uuid, source_name`,
  )) as unknown as CorrectionRow[];
  const aliasesByUuid = new Map<string, Set<string>>();
  const aliasSourceCommitsByUuid = new Map<string, string[]>();
  for (const row of aliasRows) {
    const uuid = valueString(row.uuid, "Instructor alias UUID").toLowerCase();
    const names = aliasesByUuid.get(uuid) ?? new Set<string>();
    names.add(row.name);
    aliasesByUuid.set(uuid, names);
    const commits = aliasSourceCommitsByUuid.get(uuid) ?? [];
    commits.push(row.source_commit);
    aliasSourceCommitsByUuid.set(uuid, commits);
  }
  const events = eventRows.map(identityEvent);
  const corrections = correctionRows.map(correction);
  const identityHistory = buildInstructorIdentityHistory({
    sourceCommit: rankingRevision,
    identities: identityRows.map((row) => {
      const uuid = valueString(row.uuid, "Instructor UUID");
      return {
        uuid,
        itsc: row.itsc,
        aliasSourceCommits:
          aliasSourceCommitsByUuid.get(uuid.toLowerCase()) ?? [],
      };
    }),
    events,
    associationCorrections: corrections,
  });

  const identityByUuid = new Map(
    identityRows.map((row) => [
      valueString(row.uuid, "Instructor UUID").toLowerCase(),
      row,
    ]),
  );
  const instructors = [...identityByUuid.entries()]
    .map(([uuid, row]) => ({
      uuid,
      canonicalName: valueString(
        row.canonical_name,
        "Canonical Instructor Name",
      ),
      ...(identityHistory.itscByUuid.has(uuid)
        ? { itsc: identityHistory.itscByUuid.get(uuid) as string }
        : {}),
    }))
    .sort((left, right) => left.uuid.localeCompare(right.uuid));
  const instructorAliases = aliasRows
    .map((row) => ({
      uuid: valueString(row.uuid, "Instructor alias UUID").toLowerCase(),
      name: valueString(row.name, "Instructor alias"),
      source: valueString(row.source, "Instructor alias source"),
      sourceCommit: valueString(
        row.source_commit,
        "Instructor alias source commit",
      ),
      ...(optionalString(row.source_file)
        ? { sourceFile: row.source_file as string }
        : {}),
    }))
    .sort((left, right) =>
      `${left.uuid}\0${left.name}\0${left.source}`.localeCompare(
        `${right.uuid}\0${right.name}\0${right.source}`,
      ),
    );
  const instructorRedirects = [...identityHistory.redirectByUuid.entries()]
    .map(([from, to]) => ({ from, to }))
    .sort((left, right) => left.from.localeCompare(right.from));
  const associationCorrections = [
    ...identityHistory.associationCorrections,
  ].sort((left, right) =>
    `${left.sourceCommit}\0${left.sourceName}\0${left.courseCode}\0${left.termCode ?? ""}`.localeCompare(
      `${right.sourceCommit}\0${right.sourceName}\0${right.courseCode}\0${right.termCode ?? ""}`,
    ),
  );

  const courseRows = await readRows(
    connection,
    `SELECT prefix, number FROM read_parquet('${ranking("courses.parquet")}')
     UNION
     SELECT subject AS prefix, code AS number
     FROM read_parquet('${ranking("course-ratings.parquet")}')
     ORDER BY prefix, number`,
  );
  const coursesByCode = new Map(
    courseRows.map((row) => {
      const course = {
        prefix: valueString(row.prefix, "Course Prefix"),
        number: valueString(row.number, "Course Number"),
      };
      return [courseCode(course.prefix, course.number), course] as const;
    }),
  );

  const relationRows = (await readRows(
    connection,
    `SELECT DISTINCT uuid, term_num, term_code, subject, code, name FROM read_parquet('${ranking("course-instructors.parquet")}') ORDER BY term_num, subject, code, uuid`,
  )) as unknown as RelationRow[];
  const relations = [
    ...new Map(
      relationRows.map((row) => {
        const relation = {
          uuid: valueString(row.uuid, "relation Instructor UUID").toLowerCase(),
          termNumber: Number(row.term_num),
          termCode: valueString(row.term_code, "relation Term Code"),
          courseCode: courseCode(
            valueString(row.subject, "relation Course Prefix"),
            valueString(row.code, "relation Course Number"),
          ),
        };
        return [
          `${relation.uuid}\0${relation.termCode}\0${relation.courseCode}`,
          relation,
        ] as const;
      }),
    ).values(),
  ];

  const activeCourseOfferings = (await readRows(
    connection,
    `WITH latest AS (
      SELECT *, row_number() OVER (PARTITION BY term_num, id ORDER BY timestamp DESC) AS rn
      FROM read_parquet('${schedule("courses.parquet")}')
    )
    SELECT term_num, term_code, term_name, id, prefix, number
    FROM latest
    WHERE rn = 1 AND status = 'ACTIVE'
    ORDER BY term_num, prefix, number, id`,
  )) as unknown as ScheduleCourseRow[];
  const courseOfferings = activeCourseOfferings.map((row) => {
    const prefix = valueString(row.prefix, "Course Offering Course Prefix");
    const number = valueString(row.number, "Course Offering Course Number");
    coursesByCode.set(courseCode(prefix, number), { prefix, number });
    return {
      termNumber: Number(row.term_num),
      termCode: valueString(row.term_code, "Course Offering Term Code"),
      termName: valueString(row.term_name, "Course Offering Term Name"),
      courseId: valueString(row.id, "Course Offering id"),
      courseCode: courseCode(prefix, number),
    };
  });
  const courses = [...coursesByCode.values()].sort((left, right) =>
    courseCode(left.prefix, left.number).localeCompare(
      courseCode(right.prefix, right.number),
    ),
  );
  const activeCourseIds = new Set(
    activeCourseOfferings.map(
      (row) => `${row.term_num}\0${valueString(row.id, "Course Offering id")}`,
    ),
  );

  const activeClasses = (await readRows(
    connection,
    `WITH latest_courses AS (
      SELECT *, row_number() OVER (PARTITION BY term_num, id ORDER BY timestamp DESC) AS rn
      FROM read_parquet('${schedule("courses.parquet")}')
    ), latest_classes AS (
      SELECT *, row_number() OVER (PARTITION BY term_num, course_id, section ORDER BY timestamp DESC) AS rn
      FROM read_parquet('${schedule("classes.parquet")}')
    )
    SELECT
      class.term_num, class.term_code, class.course_id, class.section, class.number,
      class.schedules, course.prefix AS course_prefix, course.number AS course_number
    FROM latest_classes AS class
    JOIN latest_courses AS course
      ON course.term_num = class.term_num AND course.id = class.course_id AND course.rn = 1
    WHERE class.rn = 1 AND class.status = 'ACTIVE' AND course.status = 'ACTIVE'
    ORDER BY class.term_num, course.prefix, course.number, class.course_id, class.section`,
  )) as unknown as ScheduleClassRow[];
  for (const row of activeClasses)
    if (!activeCourseIds.has(`${row.term_num}\0${row.course_id}`))
      throw new Error("Active Class references an inactive Course Offering");

  const classes = activeClasses.map((row) => ({
    termNumber: Number(row.term_num),
    termCode: valueString(row.term_code, "Class Term Code"),
    courseId: valueString(row.course_id, "Class Course id"),
    section: valueString(row.section, "Class Section"),
    classNumber: Number(row.number),
    courseCode: courseCode(
      valueString(row.course_prefix, "Class Course Prefix"),
      valueString(row.course_number, "Class Course Number"),
    ),
  }));

  const namesByUuid = new Map<string, Set<string>>();
  for (const identity of instructors) {
    const names = namesByUuid.get(identity.uuid) ?? new Set<string>();
    names.add(identity.canonicalName);
    namesByUuid.set(identity.uuid, names);
  }
  for (const alias of instructorAliases) {
    const names = namesByUuid.get(alias.uuid) ?? new Set<string>();
    names.add(alias.name);
    namesByUuid.set(alias.uuid, names);
  }
  for (const row of relationRows) {
    const uuid = row.uuid.toLowerCase();
    const names = namesByUuid.get(uuid) ?? new Set<string>();
    names.add(row.name);
    namesByUuid.set(uuid, names);
  }

  const relationUuidsByCourse = new Map<string, Set<string>>();
  for (const row of relationRows) {
    const key = `${row.term_code}\0${courseCode(row.subject, row.code)}`;
    const uuids = relationUuidsByCourse.get(key) ?? new Set<string>();
    uuids.add(row.uuid.toLowerCase());
    relationUuidsByCourse.set(key, uuids);
  }
  const classInstructors: ServerIndex["classInstructors"] = [];
  for (const row of activeClasses) {
    const termCode = valueString(row.term_code, "Class Term Code");
    const prefix = valueString(row.course_prefix, "Class Course Prefix");
    const number = valueString(row.course_number, "Class Course Number");
    const code = courseCode(prefix, number);
    const relationUuids = [
      ...(relationUuidsByCourse.get(`${termCode}\0${code}`) ?? []),
    ];
    const schedules = Array.isArray(row.schedules) ? row.schedules : [];
    const sourceNames = new Set<string>();
    for (const schedule of schedules) {
      if (!schedule || typeof schedule !== "object") continue;
      const instructorsValue = (schedule as { instructors?: unknown })
        .instructors;
      if (!Array.isArray(instructorsValue)) continue;
      for (const sourceName of instructorsValue) {
        if (typeof sourceName !== "string") continue;
        const clean = sourceName.trim();
        if (clean && normalized(clean) !== "tba") sourceNames.add(clean);
      }
    }
    for (const sourceName of sourceNames) {
      const scopedCorrection = identityHistory.matchAssociation({
        sourceName,
        termCode,
        courseCode: code,
      });
      const resolved = new Set<string>();
      if (
        scopedCorrection?.targetUuid &&
        relationUuids.includes(scopedCorrection.targetUuid)
      )
        resolved.add(scopedCorrection.targetUuid);
      const matching = relationUuids.filter((uuid) =>
        [...(namesByUuid.get(uuid) ?? [])].some(
          (name) => normalized(name) === normalized(sourceName),
        ),
      );
      const candidates = matching;
      for (const uuid of candidates) {
        const names = [...(namesByUuid.get(uuid) ?? [])];
        const result = identityHistory.resolveAssociation({
          sourceName,
          sourceAliases: names,
          termCode,
          courseCode: code,
          uuid,
        });
        if (result.status === "resolved") resolved.add(result.uuid);
      }
      if (resolved.size !== 1) continue;
      classInstructors.push({
        termCode,
        courseId: valueString(row.course_id, "Class Course id"),
        section: valueString(row.section, "Class Section"),
        classNumber: Number(row.number),
        uuid: [...resolved][0] as string,
        sourceName,
      });
    }
  }
  classInstructors.sort((left, right) =>
    `${left.termCode}\0${left.courseId}\0${left.section}\0${left.sourceName}\0${left.uuid}`.localeCompare(
      `${right.termCode}\0${right.courseId}\0${right.section}\0${right.sourceName}\0${right.uuid}`,
    ),
  );

  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    generation,
    courses,
    instructors,
    instructorAliases,
    instructorIdentityEvents: [...identityHistory.events],
    instructorRedirects,
    associationCorrections,
    relations,
    courseOfferings,
    classes,
    classInstructors,
  };
}

function generationHash(
  rankingRevision: string,
  scheduleRevision: string,
  artifacts: Record<DeliveryArtifactName, { sha256: string }>,
  serverIndexIdentitySha256: string,
): string {
  return createHash("sha256")
    .update(
      deliveryGenerationIdentityInput({
        sources: { rankings: rankingRevision, schedule: scheduleRevision },
        artifacts,
        serverIndexIdentitySha256,
      }),
    )
    .digest("hex");
}

async function existingGeneration(
  directory: string,
  expected: DeliveryManifest,
): Promise<boolean> {
  if (!(await fileExists(directory))) return false;
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as DeliveryManifest;
  if (JSON.stringify(manifest) !== JSON.stringify(expected))
    throw new Error(`Delivery generation is not immutable: ${directory}`);
  for (const [name, declaration] of [
    ...Object.entries(expected.artifacts),
    [expected.serverIndex.name, expected.serverIndex],
  ] as Array<[string, { bytes: number; sha256: string }]>) {
    const actual = await declarationForExisting(join(directory, name));
    if (
      actual.bytes !== declaration.bytes ||
      actual.sha256 !== declaration.sha256
    )
      throw new Error(`Delivery generation is not immutable: ${directory}`);
  }
  return true;
}

async function declarationForExisting(path: string) {
  try {
    return await declaration(path);
  } catch {
    throw new Error(`Delivery generation is not immutable: ${path}`);
  }
}

export async function buildDeliveryGeneration(
  input: BuildDeliveryGenerationOptions,
): Promise<BuildDeliveryGenerationResult> {
  const options = {
    ...input,
    rankingDirectory: resolve(input.rankingDirectory),
    scheduleDirectory: resolve(input.scheduleDirectory),
    outputDirectory: resolve(input.outputDirectory),
    rankingRevision: revision(input.rankingRevision, "Ranking revision"),
    scheduleRevision: revision(input.scheduleRevision, "Schedule revision"),
  };
  await mkdir(options.outputDirectory, { recursive: true });
  const staging = await mkdtemp(
    join(options.outputDirectory, ".delivery-staging-"),
  );
  let installed = false;
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    await connection.run("SET threads = 1");
    await validateInputs(connection, options);
    const ranking = (filename: string) =>
      sqlPath(join(options.rankingDirectory, filename));
    const schedule = (filename: string) =>
      sqlPath(join(options.scheduleDirectory, filename));

    await copyParquet(
      connection,
      join(staging, "course-ratings.parquet"),
      `SELECT subject, code, term_num, term_code, is_offered, criterion,
          bayesian::DOUBLE AS bayesian, confidence::DOUBLE AS confidence,
          samples, cumulative_samples
       FROM read_parquet('${ranking("course-ratings.parquet")}')
       ORDER BY subject, code, term_num, criterion`,
    );
    await copyParquet(
      connection,
      join(staging, "courses.parquet"),
      `SELECT prefix, number, title, attributes
       FROM read_parquet('${ranking("courses.parquet")}')
       ORDER BY prefix, number`,
    );
    await copyParquet(
      connection,
      join(staging, "instructor-aliases.parquet"),
      `SELECT uuid, name, source, source_commit, source_file
       FROM read_parquet('${ranking("instructor-aliases.parquet")}')
       ORDER BY uuid, name, source, source_commit`,
    );
    await copyParquet(
      connection,
      join(staging, "instructor-identity-events.parquet"),
      `SELECT event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid
       FROM read_parquet('${ranking("instructor-identity-events.parquet")}')
       ORDER BY source_commit, event_type, uuid, retired_uuid, survivor_uuid, source_uuid, new_uuid`,
    );
    await copyParquet(
      connection,
      join(staging, "instructor-ratings.parquet"),
      `SELECT uuid, term_num, term_code, is_teaching, criterion,
          bayesian::DOUBLE AS bayesian, confidence::DOUBLE AS confidence,
          samples, cumulative_samples
       FROM read_parquet('${ranking("instructor-ratings.parquet")}')
       ORDER BY uuid, term_num, criterion`,
    );
    await copyParquet(
      connection,
      join(staging, "instructor-split-associations.parquet"),
      `SELECT correction_type, source_commit, target_uuid, source_name, term_code, course_code
       FROM read_parquet('${ranking("instructor-split-affected-associations.parquet")}')
       ORDER BY source_commit, correction_type, target_uuid, source_name, term_code, course_code`,
    );
    await copyParquet(
      connection,
      join(staging, "instructors.parquet"),
      `SELECT uuid, canonical_name, itsc
       FROM read_parquet('${ranking("instructor-identities.parquet")}')
       ORDER BY canonical_name, uuid`,
    );
    await copyParquet(
      connection,
      join(staging, "relation.parquet"),
      `SELECT DISTINCT uuid, term_num, term_code, subject, code
       FROM read_parquet('${ranking("course-instructors.parquet")}')
       ORDER BY term_num, subject, code, uuid`,
    );
    await copyParquet(
      connection,
      join(staging, "schedule-classes.parquet"),
      `SELECT term_num, term_code, term_name, course_id, section, number,
          role, type, association, remarks, capacity, enroll, wait, consent,
          open, schedules, reservations, status, timestamp
       FROM read_parquet('${schedule("classes.parquet")}')
       ORDER BY term_num, course_id, section, timestamp`,
    );
    await copyParquet(
      connection,
      join(staging, "schedule-courses.parquet"),
      `SELECT term_num, term_code, term_name, id, prefix, number, career,
          title, description, credits::DOUBLE AS credits, previous,
          prerequisite, corequisite, exclusion, attributes, status, timestamp
       FROM read_parquet('${schedule("courses.parquet")}')
       ORDER BY term_num, id, timestamp`,
    );
    const waitlistSourceAvailable = await copyWaitlistEvidence(
      connection,
      join(staging, WAITLIST_EVIDENCE_FILENAME),
      options.scheduleDirectory,
    );

    const declarations = {} as Record<
      DeliveryArtifactName,
      { bytes: number; sha256: string }
    >;
    for (const filename of DELIVERY_ARTIFACTS)
      declarations[filename] = await declaration(join(staging, filename));
    const serverIndexContent = await buildServerIndex(
      connection,
      options.rankingDirectory,
      options.scheduleDirectory,
      options.rankingRevision,
      "",
    );
    const serverIndexIdentitySha256 = createHash("sha256")
      .update(
        gzipSync(
          Buffer.from(
            `${JSON.stringify({ ...serverIndexContent, generation: "" })}\n`,
          ),
          { level: 9 },
        ),
      )
      .digest("hex");
    const generation = generationHash(
      options.rankingRevision,
      options.scheduleRevision,
      declarations,
      serverIndexIdentitySha256,
    );
    const serverIndex = { ...serverIndexContent, generation };
    const serverIndexPath = join(staging, SERVER_INDEX_FILENAME);
    await writeFile(
      serverIndexPath,
      gzipSync(Buffer.from(`${JSON.stringify(serverIndex)}\n`), { level: 9 }),
    );
    const serverIndexDeclaration = await declaration(serverIndexPath);
    const artifacts = {} as Record<
      DeliveryArtifactName,
      DeliveryArtifactDeclaration
    >;
    for (const filename of DELIVERY_ARTIFACTS) {
      const item = declarations[filename];
      artifacts[filename] = {
        ...item,
        url: `${DELIVERY_CDN_BASE_URL}/${generation}/${filename}`,
      };
    }
    const manifest: DeliveryManifest = {
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      generation,
      sources: {
        rankings: options.rankingRevision,
        schedule: options.scheduleRevision,
      },
      artifacts,
      waitlistEvidence: waitlistEvidenceMetadata(
        options.scheduleRevision,
        waitlistSourceAvailable,
      ),
      serverIndex: {
        name: SERVER_INDEX_FILENAME,
        url: SERVER_INDEX_FILENAME,
        generation,
        bytes: serverIndexDeclaration.bytes,
        sha256: serverIndexDeclaration.sha256,
        identitySha256: serverIndexIdentitySha256,
      },
    };
    await writeFile(
      join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const destination = join(options.outputDirectory, generation);
    if (await existingGeneration(destination, manifest)) {
      await rm(staging, { recursive: true, force: true });
      installed = true;
      return {
        directory: destination,
        generation,
        manifest,
        serverIndex,
      };
    }
    await rename(staging, destination);
    installed = true;
    return {
      directory: destination,
      generation,
      manifest,
      serverIndex,
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
    if (!installed) await rm(staging, { recursive: true, force: true });
  }
}

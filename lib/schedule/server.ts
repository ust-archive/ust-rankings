import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type DuckDBConnection,
  DuckDBInstance,
  type DuckDBValue,
} from "@duckdb/node-api";

const SEED_SHA = "0ddb2e493caeeb8aa9c56728496c866c358a2431";
const ARTIFACTS = ["classes.parquet", "courses.parquet"] as const;
const schemas = {
  "courses.parquet": [
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["term_name", "VARCHAR"],
    ["id", "VARCHAR"],
    ["prefix", "VARCHAR"],
    ["number", "VARCHAR"],
    ["career", "VARCHAR"],
    ["title", "VARCHAR"],
    ["description", "VARCHAR"],
    ["credits", "DOUBLE"],
    ["previous", "VARCHAR"],
    ["prerequisite", "VARCHAR"],
    ["corequisite", "VARCHAR"],
    ["exclusion", "VARCHAR"],
    [
      "attributes",
      'STRUCT("label" VARCHAR, "value" VARCHAR, description VARCHAR)[]',
    ],
    ["status", "VARCHAR"],
    ["timestamp", "TIMESTAMP WITH TIME ZONE"],
  ],
  "classes.parquet": [
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["term_name", "VARCHAR"],
    ["course_id", "VARCHAR"],
    ["section", "VARCHAR"],
    ["number", "INTEGER"],
    ["role", "VARCHAR"],
    ["type", "VARCHAR"],
    ["association", "INTEGER"],
    ["remarks", "VARCHAR"],
    ["capacity", "INTEGER"],
    ["enroll", "INTEGER"],
    ["wait", "INTEGER"],
    ["consent", "BOOLEAN"],
    ["open", "BOOLEAN"],
    [
      "schedules",
      "STRUCT(weekday VARCHAR, date_from DATE, date_to DATE, time_from TIME, time_to TIME, venue VARCHAR, venue_name VARCHAR, instructors VARCHAR[])[]",
    ],
    ["reservations", 'STRUCT("name" VARCHAR, quota INTEGER, enroll INTEGER)[]'],
    ["status", "VARCHAR"],
    ["timestamp", "TIMESTAMP WITH TIME ZONE"],
  ],
} as const;

type Manifest = {
  schemaMajor: number;
  sourceCommit: string;
  artifacts: Record<string, { sha256: string; size: number }>;
  instructors: Array<{ sourceName: string; uuid: string }>;
};

type Generation = {
  sha: string;
  directory: string;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  instructors: Map<string, string>;
};

export type ScheduleTerm = {
  termNumber: number;
  termCode: string;
  termName: string;
};

export type ScheduleInstructor = {
  sourceName: string;
  uuid?: string;
};

export type ScheduleMeeting = {
  weekday: "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  room: string;
  roomCode: string;
  instructors: ScheduleInstructor[];
};

export type ScheduleClass = {
  termCode: string;
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  courseTitle: string;
  section: string;
  classNumber: number;
  role: "E" | "N";
  classType: "LEC" | "TUT" | "LAB" | "IND";
  association?: number;
  remarks: string;
  capacity: number;
  enrollment: number;
  waitlist: number;
  consent: boolean;
  open: boolean;
  meetings: ScheduleMeeting[];
  reservations: Array<{ name: string; quota: number; enrollment: number }>;
};

export type CourseOffering = {
  termNumber: number;
  termCode: string;
  termName: string;
  courseId: string;
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  career: "UGRD" | "TPG" | "RPG" | "EXEC";
  title: string;
  description: string;
  credits: number;
  previousCourseCodes: string;
  prerequisite: string;
  corequisite: string;
  exclusion: string;
  attributes: Array<{ label: string; value: string; description: string }>;
  classes: ScheduleClass[];
};

export type SchedulePage = {
  generation: string;
  terms: ScheduleTerm[];
  term: ScheduleTerm;
  search?: string;
  results: CourseOffering[];
  total: number;
};

export type ScheduleEntity =
  | { type: "course"; coursePrefix: string; courseNumber: string }
  | {
      type: "course-offering";
      termCode: string;
      coursePrefix: string;
      courseNumber: string;
    }
  | {
      type: "class";
      termCode: string;
      coursePrefix: string;
      courseNumber: string;
      section: string;
    };

export type ScheduleDetails =
  | ({ type: "course"; offerings: CourseOffering[] } & Pick<
      CourseOffering,
      "coursePrefix" | "courseNumber" | "courseCode"
    >)
  | ({ type: "course-offering" } & CourseOffering)
  | ({ type: "class" } & ScheduleClass);

export class ScheduleUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("UST Schedule is unavailable.", options);
    this.name = "ScheduleUnavailableError";
  }
}

export class InvalidScheduleQueryError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleQueryError";
  }
}

let loaded: { directory: string; generation: Promise<Generation> } | undefined;
const queryQueues = new WeakMap<DuckDBConnection, Promise<void>>();
const queuedQueryCounts = new WeakMap<DuckDBConnection, number>();

function seedDirectory() {
  return (
    process.env.SCHEDULE_SEED_DIR ??
    resolve(process.cwd(), "schedule", "seed", SEED_SHA)
  );
}

function sqlPath(directory: string, filename: string) {
  return resolve(directory, filename)
    .replaceAll("\\", "/")
    .replaceAll("'", "''");
}

async function queryRows(
  connection: DuckDBConnection,
  sql: string,
  parameters?: Record<string, DuckDBValue>,
) {
  const queuedCount = queuedQueryCounts.get(connection) ?? 0;
  if (queuedCount >= 8) throw new ScheduleUnavailableError();
  queuedQueryCounts.set(connection, queuedCount + 1);
  const previous = queryQueues.get(connection) ?? Promise.resolve();
  let release = () => {};
  const queued = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  queryQueues.set(
    connection,
    previous.then(() => queued),
  );
  await previous;
  const query = connection.runAndReadAll(sql, parameters);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reader = await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          connection.interrupt();
          reject(new ScheduleUnavailableError());
        }, 5_000);
      }),
    ]);
    return reader.getRowObjectsJS() as Array<Record<string, unknown>>;
  } finally {
    if (timer) clearTimeout(timer);
    await query.catch(() => undefined);
    queuedQueryCounts.set(
      connection,
      Math.max((queuedQueryCounts.get(connection) ?? 1) - 1, 0),
    );
    release();
  }
}

async function validateFiles(directory: string, manifest: Manifest) {
  const parquetFiles = (await readdir(directory))
    .filter((name) => name.endsWith(".parquet"))
    .sort();
  if (JSON.stringify(parquetFiles) !== JSON.stringify(ARTIFACTS))
    throw new Error("Unexpected Schedule artifacts");
  if (
    manifest.schemaMajor !== 0 ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
    basename(resolve(directory)) !== manifest.sourceCommit ||
    JSON.stringify(Object.keys(manifest.artifacts).sort()) !==
      JSON.stringify(ARTIFACTS)
  )
    throw new Error("Invalid Schedule manifest");

  await Promise.all(
    ARTIFACTS.map(async (filename) => {
      const path = resolve(directory, filename);
      const declaration = manifest.artifacts[filename];
      const bytes = await readFile(/* turbopackIgnore: true */ path);
      if (
        !declaration ||
        !Number.isSafeInteger(declaration.size) ||
        declaration.size <= 0 ||
        bytes.length !== declaration.size ||
        (await stat(/* turbopackIgnore: true */ path)).size !==
          declaration.size ||
        !/^[0-9a-f]{64}$/.test(declaration.sha256)
      )
        throw new Error(`${filename} declaration mismatch`);
      if (
        bytes.subarray(0, 4).toString() !== "PAR1" ||
        bytes.subarray(-4).toString() !== "PAR1"
      )
        throw new Error(`${filename} is not framed as Parquet`);
      if (
        createHash("sha256").update(bytes).digest("hex") !== declaration.sha256
      )
        throw new Error(`${filename} checksum mismatch`);
    }),
  );
}

function validateInstructorMappings(manifest: Manifest) {
  if (!Array.isArray(manifest.instructors))
    throw new Error("Invalid Schedule Instructor mappings");
  const mappings = new Map<string, string>();
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const instructor of manifest.instructors) {
    const sourceName = instructor.sourceName?.trim();
    const normalized = sourceName?.toLocaleLowerCase();
    if (
      !sourceName ||
      normalized === "tba" ||
      !uuidPattern.test(instructor.uuid) ||
      mappings.has(normalized)
    )
      throw new Error("Invalid Schedule Instructor mapping");
    mappings.set(normalized, instructor.uuid);
  }
  return mappings;
}

async function validateRelations(
  connection: DuckDBConnection,
  directory: string,
) {
  for (const filename of ARTIFACTS) {
    const path = sqlPath(directory, filename);
    const described = await queryRows(
      connection,
      `DESCRIBE SELECT * FROM read_parquet('${path}')`,
    );
    const actual = described.map((column) => [
      column.column_name,
      column.column_type,
    ]);
    if (JSON.stringify(actual) !== JSON.stringify(schemas[filename]))
      throw new Error(`${filename} schema mismatch`);
    const [{ count }] = await queryRows(
      connection,
      `SELECT count(*)::INTEGER AS count FROM read_parquet('${path}')`,
    );
    if (count === 0) throw new Error(`${filename} is empty`);
  }

  const courses = sqlPath(directory, "courses.parquet");
  const classes = sqlPath(directory, "classes.parquet");
  const checks = [
    `SELECT term_num, id, timestamp FROM read_parquet('${courses}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT term_num, prefix, number, timestamp FROM read_parquet('${courses}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT term_num, course_id, section, timestamp FROM read_parquet('${classes}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT term_num, number, timestamp FROM read_parquet('${classes}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT 1 FROM read_parquet('${courses}') WHERE term_num IS NULL OR term_code IS NULL OR term_name IS NULL OR id IS NULL OR prefix IS NULL OR number IS NULL OR career NOT IN ('UGRD', 'TPG', 'RPG', 'EXEC') OR title IS NULL OR description IS NULL OR credits IS NULL OR attributes IS NULL OR status NOT IN ('ACTIVE', 'INACTIVE') OR timestamp IS NULL`,
    `SELECT 1 FROM read_parquet('${classes}') WHERE term_num IS NULL OR term_code IS NULL OR term_name IS NULL OR course_id IS NULL OR section IS NULL OR number IS NULL OR role NOT IN ('E', 'N') OR type NOT IN ('LEC', 'TUT', 'LAB', 'IND') OR capacity IS NULL OR enroll IS NULL OR wait IS NULL OR consent IS NULL OR open IS NULL OR schedules IS NULL OR reservations IS NULL OR status NOT IN ('ACTIVE', 'INACTIVE') OR timestamp IS NULL`,
    `SELECT term_num FROM read_parquet(['${courses}', '${classes}'], union_by_name=true) GROUP BY term_num HAVING count(DISTINCT term_code) <> 1 OR count(DISTINCT term_name) <> 1`,
    `SELECT term_code FROM read_parquet(['${courses}', '${classes}'], union_by_name=true) GROUP BY term_code HAVING count(DISTINCT term_num) <> 1 OR count(DISTINCT term_name) <> 1`,
    `WITH latest_courses AS (SELECT *, row_number() OVER (PARTITION BY term_num, id ORDER BY timestamp DESC) AS rn FROM read_parquet('${courses}')), latest_classes AS (SELECT *, row_number() OVER (PARTITION BY term_num, course_id, section ORDER BY timestamp DESC) AS rn FROM read_parquet('${classes}')) SELECT 1 FROM latest_classes class LEFT JOIN latest_courses course ON class.term_num = course.term_num AND class.course_id = course.id AND course.rn = 1 WHERE class.rn = 1 AND class.status = 'ACTIVE' AND course.id IS NULL`,
    `WITH latest_classes AS (SELECT *, row_number() OVER (PARTITION BY term_num, course_id, section ORDER BY timestamp DESC) AS rn FROM read_parquet('${classes}')) SELECT term_num, number FROM latest_classes WHERE rn = 1 AND status = 'ACTIVE' GROUP BY ALL HAVING count(*) > 1`,
  ];
  for (const check of checks) {
    if ((await queryRows(connection, `${check} LIMIT 1`)).length > 0)
      throw new Error("Schedule relation invariant failed");
  }

  const smokeQueries = [
    `WITH latest AS (SELECT *, row_number() OVER (PARTITION BY term_num, id ORDER BY timestamp DESC) rn FROM read_parquet('${courses}')) SELECT prefix, number FROM latest WHERE rn = 1 AND status = 'ACTIVE' LIMIT 1`,
    `WITH latest AS (SELECT *, row_number() OVER (PARTITION BY term_num, course_id, section ORDER BY timestamp DESC) rn FROM read_parquet('${classes}')) SELECT number FROM latest WHERE rn = 1 AND status = 'ACTIVE' LIMIT 1`,
  ];
  for (const smokeQuery of smokeQueries) {
    if ((await queryRows(connection, smokeQuery)).length !== 1)
      throw new Error("Representative Schedule query failed");
  }
}

async function loadGeneration(directory: string): Promise<Generation> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "manifest.json"), "utf8"),
    ) as Manifest;
    await validateFiles(directory, manifest);
    const instructors = validateInstructorMappings(manifest);
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run("SET threads = 1");
    await connection.run("SET memory_limit = '384MB'");
    try {
      await validateRelations(connection, directory);
      return {
        sha: manifest.sourceCommit,
        directory,
        instance,
        connection,
        instructors,
      };
    } catch (error) {
      connection.closeSync();
      instance.closeSync();
      throw error;
    }
  } catch (error) {
    throw new ScheduleUnavailableError({ cause: error });
  }
}

function generation() {
  const directory = seedDirectory();
  if (loaded?.directory !== directory) {
    const previous = loaded?.generation;
    loaded = { directory, generation: loadGeneration(directory) };
    void previous?.then(closeGeneration).catch(() => undefined);
  }
  return loaded.generation;
}

function closeGeneration(generation: Generation) {
  generation.connection.closeSync();
  generation.instance.closeSync();
}

export async function resetScheduleRuntimeForTests() {
  const previous = loaded?.generation;
  loaded = undefined;
  if (previous) await previous.then(closeGeneration).catch(() => undefined);
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function numeric(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function date(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value).slice(0, 10);
}

function time(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const microseconds = numeric(value);
  const minutes = Math.floor(microseconds / 60_000_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function validateTermCode(termCode: string) {
  const normalized = termCode.trim();
  if (!/^[0-9]{4}$/.test(normalized))
    throw new InvalidScheduleQueryError("Invalid Term Code.");
  return normalized;
}

function validateCourse(prefix: string, number: string) {
  const coursePrefix = prefix.trim().toUpperCase();
  const courseNumber = number.trim().toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(coursePrefix))
    throw new InvalidScheduleQueryError("Invalid Course Prefix.");
  if (!/^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(courseNumber))
    throw new InvalidScheduleQueryError("Invalid Course Number.");
  return { coursePrefix, courseNumber };
}

const offeringSql = (directory: string) => `
  WITH courses AS (
    SELECT * EXCLUDE (rn) FROM (
      SELECT *, row_number() OVER (
        PARTITION BY term_num, id ORDER BY timestamp DESC
      ) AS rn
      FROM read_parquet('${sqlPath(directory, "courses.parquet")}')
    ) WHERE rn = 1 AND status = 'ACTIVE'
  ), classes AS (
    SELECT * EXCLUDE (rn) FROM (
      SELECT *, row_number() OVER (
        PARTITION BY term_num, course_id, section ORDER BY timestamp DESC
      ) AS rn
      FROM read_parquet('${sqlPath(directory, "classes.parquet")}')
    ) WHERE rn = 1 AND status = 'ACTIVE'
  )
  SELECT
    course.term_num, course.term_code, course.term_name, course.id AS course_id,
    course.prefix, course.number AS course_number, course.career, course.title,
    course.description, course.credits, course.previous, course.prerequisite,
    course.corequisite, course.exclusion, course.attributes,
    class.section, class.number AS class_number, class.role,
    class.type AS class_type, class.association, class.remarks, class.capacity,
    class.enroll, class.wait, class.consent, class.open, class.schedules,
    class.reservations
  FROM courses course
  JOIN classes class
    ON course.term_num = class.term_num AND course.id = class.course_id
`;

type NestedMeeting = {
  weekday?: unknown;
  date_from?: unknown;
  date_to?: unknown;
  time_from?: unknown;
  time_to?: unknown;
  venue?: unknown;
  venue_name?: unknown;
  instructors?: unknown;
};

function mapRows(rows: Array<Record<string, unknown>>, accepted: Generation) {
  const offerings = new Map<string, CourseOffering>();
  for (const row of rows) {
    const key = `${row.term_num}\0${row.course_id}`;
    let offering = offerings.get(key);
    if (!offering) {
      const coursePrefix = text(row.prefix);
      const courseNumber = text(row.course_number);
      offering = {
        termNumber: numeric(row.term_num),
        termCode: text(row.term_code),
        termName: text(row.term_name),
        courseId: text(row.course_id),
        coursePrefix,
        courseNumber,
        courseCode: `${coursePrefix} ${courseNumber}`,
        career: text(row.career) as CourseOffering["career"],
        title: text(row.title),
        description: text(row.description),
        credits: numeric(row.credits),
        previousCourseCodes: text(row.previous),
        prerequisite: text(row.prerequisite),
        corequisite: text(row.corequisite),
        exclusion: text(row.exclusion),
        attributes: (
          (row.attributes as Array<Record<string, unknown>> | undefined) ?? []
        ).map((attribute) => ({
          label: text(attribute.label),
          value: text(attribute.value),
          description: text(attribute.description),
        })),
        classes: [],
      };
      offerings.set(key, offering);
    }
    const meetings = ((row.schedules as NestedMeeting[] | undefined) ?? []).map(
      (meeting) => ({
        weekday: text(meeting.weekday) as ScheduleMeeting["weekday"],
        dateFrom: date(meeting.date_from),
        dateTo: date(meeting.date_to),
        timeFrom: time(meeting.time_from),
        timeTo: time(meeting.time_to),
        room: text(meeting.venue_name) || text(meeting.venue),
        roomCode: text(meeting.venue),
        instructors: ((meeting.instructors as unknown[] | undefined) ?? []).map(
          (value) => {
            const sourceName = text(value);
            const uuid = accepted.instructors.get(
              sourceName.trim().toLocaleLowerCase(),
            );
            return uuid ? { sourceName, uuid } : { sourceName };
          },
        ),
      }),
    );
    offering.classes.push({
      termCode: offering.termCode,
      coursePrefix: offering.coursePrefix,
      courseNumber: offering.courseNumber,
      courseCode: offering.courseCode,
      courseTitle: offering.title,
      section: text(row.section),
      classNumber: numeric(row.class_number),
      role: text(row.role) as ScheduleClass["role"],
      classType: text(row.class_type) as ScheduleClass["classType"],
      association:
        row.association === null || row.association === undefined
          ? undefined
          : numeric(row.association),
      remarks: text(row.remarks),
      capacity: numeric(row.capacity),
      enrollment: numeric(row.enroll),
      waitlist: numeric(row.wait),
      consent: Boolean(row.consent),
      open: Boolean(row.open),
      meetings,
      reservations: (
        (row.reservations as Array<Record<string, unknown>> | undefined) ?? []
      ).map((reservation) => ({
        name: text(reservation.name),
        quota: numeric(reservation.quota),
        enrollment: numeric(reservation.enroll),
      })),
    });
  }
  const result = [...offerings.values()];
  for (const offering of result)
    offering.classes.sort(
      (left, right) =>
        left.section.localeCompare(right.section) ||
        left.classNumber - right.classNumber,
    );
  return result.sort(
    (left, right) =>
      left.termNumber - right.termNumber ||
      left.courseCode.localeCompare(right.courseCode),
  );
}

function searchText(offering: CourseOffering) {
  return [
    offering.courseCode,
    offering.title,
    offering.description,
    offering.previousCourseCodes,
    offering.prerequisite,
    offering.corequisite,
    offering.exclusion,
    ...offering.attributes.flatMap((attribute) => Object.values(attribute)),
    ...offering.classes.flatMap((scheduleClass) => [
      scheduleClass.section,
      scheduleClass.classNumber,
      scheduleClass.remarks,
      ...scheduleClass.meetings.flatMap((meeting) => [
        meeting.room,
        meeting.roomCode,
        ...meeting.instructors.map((instructor) => instructor.sourceName),
      ]),
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

async function terms(accepted: Generation) {
  const rows = await queryRows(
    accepted.connection,
    `SELECT term_num, term_code, term_name FROM read_parquet('${sqlPath(accepted.directory, "courses.parquet")}') GROUP BY ALL ORDER BY term_num`,
  );
  return rows.map((row) => ({
    termNumber: numeric(row.term_num),
    termCode: text(row.term_code),
    termName: text(row.term_name),
  }));
}

export async function querySchedule(
  query: { termCode?: string; search?: string; limit?: number } = {},
): Promise<SchedulePage> {
  const accepted = await generation();
  const availableTerms = await terms(accepted);
  const selectedTermCode = query.termCode?.trim()
    ? validateTermCode(query.termCode)
    : availableTerms.at(-1)?.termCode;
  const term = availableTerms.find(
    (candidate) => candidate.termCode === selectedTermCode,
  );
  if (!term) throw new InvalidScheduleQueryError("Unknown Term Code.");
  const search = query.search?.trim() || undefined;
  if (search && search.length > 100)
    throw new InvalidScheduleQueryError("Search is limited to 100 characters.");
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 100);
  if (!Number.isFinite(limit))
    throw new InvalidScheduleQueryError("Invalid Schedule page size.");
  const rows = await queryRows(
    accepted.connection,
    `${offeringSql(accepted.directory)} WHERE course.term_code = $termCode ORDER BY course.prefix, course.number, class.section`,
    { termCode: term.termCode },
  );
  let offerings = mapRows(rows, accepted);
  if (search) {
    const normalized = search.toLocaleLowerCase();
    offerings = offerings.filter((offering) =>
      searchText(offering).includes(normalized),
    );
  }
  return {
    generation: accepted.sha,
    terms: availableTerms,
    term,
    search,
    total: offerings.length,
    results: offerings.slice(0, limit),
  };
}

export async function getSchedule(
  entity: ScheduleEntity,
): Promise<ScheduleDetails> {
  const accepted = await generation();
  const { coursePrefix, courseNumber } = validateCourse(
    entity.coursePrefix,
    entity.courseNumber,
  );
  const parameters: Record<string, DuckDBValue> = {
    coursePrefix,
    courseNumber,
  };
  let where =
    "WHERE course.prefix = $coursePrefix AND course.number = $courseNumber";
  if (entity.type !== "course") {
    parameters.termCode = validateTermCode(entity.termCode);
    where += " AND course.term_code = $termCode";
  }
  const rows = await queryRows(
    accepted.connection,
    `${offeringSql(accepted.directory)} ${where} ORDER BY course.term_num, class.section`,
    parameters,
  );
  const offerings = mapRows(rows, accepted);
  if (offerings.length === 0)
    throw new InvalidScheduleQueryError("Unknown Schedule entity.");
  if (entity.type === "course")
    return {
      type: "course",
      coursePrefix,
      courseNumber,
      courseCode: `${coursePrefix} ${courseNumber}`,
      offerings,
    };
  const offering = offerings[0];
  if (!offering)
    throw new InvalidScheduleQueryError("Unknown Course Offering.");
  if (entity.type === "course-offering")
    return { type: "course-offering", ...offering };
  const section = entity.section.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{0,15}$/.test(section))
    throw new InvalidScheduleQueryError("Invalid Section.");
  const scheduleClass = offering.classes.find(
    (candidate) => candidate.section === section,
  );
  if (!scheduleClass) throw new InvalidScheduleQueryError("Unknown Class.");
  return { type: "class", ...scheduleClass };
}

export async function resolveClasses(
  term: string,
  classNumbers: ReadonlyArray<number>,
): Promise<ScheduleClass[]> {
  const termCode = validateTermCode(term);
  const numbers = [...new Set(classNumbers)].sort(
    (left, right) => left - right,
  );
  if (
    numbers.length === 0 ||
    numbers.length > 100 ||
    numbers.some(
      (number) =>
        !Number.isSafeInteger(number) || number <= 0 || number > 999_999,
    )
  )
    throw new InvalidScheduleQueryError("Invalid Class Numbers.");
  const accepted = await generation();
  const rows = await queryRows(
    accepted.connection,
    `${offeringSql(accepted.directory)} WHERE course.term_code = $termCode ORDER BY class.number`,
    { termCode },
  );
  const wanted = new Set(numbers);
  const classes = mapRows(rows, accepted)
    .flatMap((offering) => offering.classes)
    .filter((scheduleClass) => wanted.has(scheduleClass.classNumber))
    .sort((left, right) => left.classNumber - right.classNumber);
  if (classes.length !== numbers.length)
    throw new InvalidScheduleQueryError("Unknown Class Number.");
  return classes;
}

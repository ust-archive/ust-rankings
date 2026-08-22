import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type DuckDBConnection,
  DuckDBInstance,
  type DuckDBValue,
} from "@duckdb/node-api";
import { normalizeInstructorUuid } from "@/lib/instructor-identity";

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
};

type Generation = {
  sha: string;
  directory: string;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  readers: number;
  retired: boolean;
  closed: boolean;
  cleanup?: () => Promise<void>;
};

export type ScheduleGenerationPointer = {
  activeSha: string;
  previousSha?: string;
  acceptedAt: string;
  sourceUpdatedAt: string;
};

export type ScheduleFailure = {
  class:
    | "configuration"
    | "upstream"
    | "integrity"
    | "storage"
    | "lock"
    | "internal";
  at: string;
};

export type ScheduleRefreshDependencies = {
  upstream: {
    download(sha?: string): Promise<{
      sha: string;
      sourceUpdatedAt: string;
      directory: string;
      artifacts?: Record<string, { sha256: string; size: number }>;
      temporary?: boolean;
    }>;
  };
  store: {
    readPointer(): Promise<ScheduleGenerationPointer | undefined>;
    downloadGeneration(sha: string): Promise<string | undefined>;
    removeCachedGeneration?(sha: string): Promise<void>;
    putGeneration(sha: string, directory: string): Promise<void>;
    writePointer(pointer: ScheduleGenerationPointer): Promise<void>;
    readFailure(): Promise<ScheduleFailure | undefined>;
    writeFailure(failure: ScheduleFailure | undefined): Promise<void>;
  };
  withLock<T>(operation: () => Promise<T>): Promise<T | undefined>;
  sleep(milliseconds: number): Promise<void>;
};

export type ScheduleRefreshResult = {
  status: "activated" | "current" | "superseded" | "busy";
  generation?: string;
};

export class ScheduleRefreshError extends Error {
  readonly failureClass: ScheduleFailure["class"];

  constructor(
    failureClass: ScheduleFailure["class"],
    options?: { cause?: unknown },
  ) {
    super("Schedule refresh failed; last-known-good remains active.", options);
    this.name = "ScheduleRefreshError";
    this.failureClass = failureClass;
  }
}

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
  courseDescription?: string;
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
  | { type: "instructor"; uuids: string[] }
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
  | { type: "instructor"; instructorUuids: string[]; classes: ScheduleClass[] }
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

let explicitGeneration:
  | { directory: string; generation?: Promise<Generation> }
  | undefined;
let runtimeActive: Promise<Generation> | undefined;
let runtimePrevious: Promise<Generation> | undefined;
let runtimeActiveSha: string | undefined;
let runtimeDependencies: ScheduleRefreshDependencies | undefined;
let runtimeCheckedAt = 0;
let runtimeDiscovery: Promise<Generation> | undefined;
let afterAcquireForTests: ((generation: string) => Promise<void>) | undefined;
const queryQueues = new WeakMap<DuckDBConnection, Promise<void>>();
const queuedQueryCounts = new WeakMap<DuckDBConnection, number>();

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

async function loadGeneration(
  directory: string,
  cleanup?: () => Promise<void>,
): Promise<Generation> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "manifest.json"), "utf8"),
    ) as Manifest;
    await validateFiles(directory, manifest);
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
        readers: 0,
        retired: false,
        closed: false,
        cleanup,
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

async function discoverGeneration() {
  const existing = runtimeActive;
  try {
    runtimeDependencies ??= (
      await import("./runtime")
    ).productionScheduleRefreshDependencies();
    const pointer = await runtimeDependencies.store.readPointer();
    if (pointer) {
      for (const sha of [pointer.activeSha, pointer.previousSha]) {
        if (!sha) continue;
        if (sha === runtimeActiveSha && runtimeActive) return runtimeActive;
        try {
          const directory =
            await runtimeDependencies.store.downloadGeneration(sha);
          if (!directory) continue;
          const loading = loadGeneration(directory);
          await installRuntimeGeneration(
            loading,
            sha,
            sha === pointer.activeSha ? pointer.previousSha : undefined,
          );
          return loading;
        } catch {
          await runtimeDependencies.store
            .removeCachedGeneration?.(sha)
            .catch(() => undefined);
        }
      }
    }
    await refreshSchedule({}, runtimeDependencies);
    if (runtimeActive) return runtimeActive;
  } catch {
    if (existing) return existing;
  }
  if (existing) return existing;
  throw new ScheduleUnavailableError();
}

function generation() {
  if (explicitGeneration) {
    explicitGeneration.generation ??= loadGeneration(
      explicitGeneration.directory,
    );
    return explicitGeneration.generation;
  }
  if (
    runtimeActive &&
    runtimeDependencies &&
    Date.now() - runtimeCheckedAt < 60_000
  )
    return runtimeActive;
  if (!runtimeDiscovery) {
    runtimeCheckedAt = Date.now();
    runtimeDiscovery = discoverGeneration().finally(() => {
      runtimeDiscovery = undefined;
    });
  }
  return runtimeDiscovery;
}

function closeRetiredGeneration(generation: Generation) {
  if (!generation.retired || generation.readers > 0 || generation.closed)
    return;
  generation.closed = true;
  generation.connection.closeSync();
  generation.instance.closeSync();
  void generation.cleanup?.().catch(() => undefined);
}

async function retireGeneration(loading?: Promise<Generation>) {
  if (!loading) return;
  const accepted = await loading.catch(() => undefined);
  if (!accepted) return;
  accepted.retired = true;
  closeRetiredGeneration(accepted);
}

async function withAcceptedGeneration<T>(
  operation: (accepted: Generation) => Promise<T>,
) {
  const accepted = await generation();
  if (accepted.closed) throw new ScheduleUnavailableError();
  accepted.readers += 1;
  try {
    await afterAcquireForTests?.(accepted.sha);
    return await operation(accepted);
  } finally {
    accepted.readers -= 1;
    closeRetiredGeneration(accepted);
  }
}

export function setScheduleAfterAcquireForTests(
  hook?: (generation: string) => Promise<void>,
) {
  afterAcquireForTests = hook;
}

async function installRuntimeGeneration(
  loading: Promise<Generation>,
  sha: string,
  previousSha?: string,
) {
  const accepted = await loading;
  if (accepted.sha !== sha) throw new ScheduleUnavailableError();
  const oldActive = runtimeActive;
  const oldPrevious = runtimePrevious;
  runtimeActive = loading;
  runtimeActiveSha = sha;
  runtimePrevious = undefined;
  if (oldActive) {
    if ((await oldActive).sha === previousSha) runtimePrevious = oldActive;
    else await retireGeneration(oldActive);
  }
  if (oldPrevious && oldPrevious !== runtimePrevious)
    await retireGeneration(oldPrevious);
}

async function prepareCandidateManifest(
  candidate: Awaited<
    ReturnType<ScheduleRefreshDependencies["upstream"]["download"]>
  >,
) {
  try {
    await stat(resolve(candidate.directory, "manifest.json"));
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    !candidate.artifacts ||
    JSON.stringify(Object.keys(candidate.artifacts).sort()) !==
      JSON.stringify(ARTIFACTS)
  )
    throw new Error("Upstream tree declarations are incomplete");
  await writeFile(
    resolve(candidate.directory, "manifest.json"),
    `${JSON.stringify(
      {
        schemaMajor: 0,
        sourceCommit: candidate.sha,
        artifacts: candidate.artifacts,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
}

export async function refreshSchedule(
  options: { sha?: string },
  dependencies: ScheduleRefreshDependencies,
): Promise<ScheduleRefreshResult> {
  if (options.sha !== undefined && !/^[0-9a-f]{40}$/.test(options.sha))
    throw new InvalidScheduleQueryError(
      "A full immutable commit SHA is required.",
    );
  let result: ScheduleRefreshResult | undefined;
  try {
    result = await dependencies.withLock(async () => {
      let current: ScheduleGenerationPointer | undefined;
      try {
        current = await dependencies.store.readPointer();
      } catch (error) {
        const failure = {
          class: "storage",
          at: new Date().toISOString(),
        } as const;
        await dependencies.store.writeFailure(failure).catch(() => undefined);
        throw new ScheduleRefreshError("storage", { cause: error });
      }
      let lastError: unknown;
      let failureClass: ScheduleFailure["class"] = "upstream";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) await dependencies.sleep(250 * 4 ** (attempt - 1));
        let accepted: Generation | undefined;
        let candidate:
          | Awaited<ReturnType<typeof dependencies.upstream.download>>
          | undefined;
        try {
          candidate = await dependencies.upstream.download(options.sha);
          failureClass = "integrity";
          if (
            !/^[0-9a-f]{40}$/.test(candidate.sha) ||
            (options.sha && candidate.sha !== options.sha) ||
            !Number.isFinite(Date.parse(candidate.sourceUpdatedAt))
          )
            throw new Error("Invalid immutable Schedule generation");
          await prepareCandidateManifest(candidate);
          const temporaryRoot = candidate.temporary
            ? resolve(candidate.directory, "..")
            : undefined;
          const loading = loadGeneration(
            candidate.directory,
            temporaryRoot
              ? () => rm(temporaryRoot, { recursive: true, force: true })
              : undefined,
          );
          accepted = await loading;
          if (accepted.sha !== candidate.sha)
            throw new Error("Candidate files are from a mixed commit");
          if (
            current &&
            Date.parse(candidate.sourceUpdatedAt) <=
              Date.parse(current.sourceUpdatedAt)
          ) {
            failureClass = "storage";
            await dependencies.store.writeFailure(undefined);
            await retireGeneration(Promise.resolve(accepted));
            return {
              status:
                candidate.sha === current.activeSha ? "current" : "superseded",
              generation: current.activeSha,
            } as const;
          }
          failureClass = "storage";
          await dependencies.store.putGeneration(
            candidate.sha,
            candidate.directory,
          );
          const pointer = {
            activeSha: candidate.sha,
            previousSha: current?.activeSha,
            acceptedAt: new Date().toISOString(),
            sourceUpdatedAt: candidate.sourceUpdatedAt,
          };
          await dependencies.store.writePointer(pointer);
          await installRuntimeGeneration(
            loading,
            candidate.sha,
            current?.activeSha,
          );
          runtimeDependencies = dependencies;
          runtimeCheckedAt = Date.now();
          await dependencies.store.writeFailure(undefined);
          return { status: "activated", generation: candidate.sha } as const;
        } catch (error) {
          lastError = error;
          if (
            typeof error === "object" &&
            error !== null &&
            "failureClass" in error &&
            ["upstream", "integrity", "storage", "internal"].includes(
              String(error.failureClass),
            )
          )
            failureClass = error.failureClass as ScheduleFailure["class"];
          if (accepted) await retireGeneration(Promise.resolve(accepted));
          else if (candidate?.temporary)
            await rm(resolve(candidate.directory, ".."), {
              recursive: true,
              force: true,
            }).catch(() => undefined);
        }
      }
      const failure = {
        class: failureClass,
        at: new Date().toISOString(),
      };
      await dependencies.store.writeFailure(failure).catch(() => undefined);
      throw new ScheduleRefreshError(failureClass, { cause: lastError });
    });
  } catch (error) {
    if (error instanceof ScheduleRefreshError) throw error;
    const failure = { class: "lock", at: new Date().toISOString() } as const;
    await dependencies.store.writeFailure(failure).catch(() => undefined);
    throw new ScheduleRefreshError("lock", { cause: error });
  }
  return result ?? { status: "busy" };
}

export async function getScheduleHealth(
  dependencies?: ScheduleRefreshDependencies,
) {
  try {
    const selected =
      dependencies ??
      runtimeDependencies ??
      (await import("./runtime")).productionScheduleRefreshDependencies();
    const [pointer, failure] = await Promise.all([
      selected.store.readPointer(),
      selected.store.readFailure(),
    ]);
    if (!pointer)
      return {
        status: "unavailable" as const,
        activeGeneration: undefined,
        acceptedAt: undefined,
        sourceUpdatedAt: undefined,
        failureClass: failure?.class ?? "configuration",
        failureAt: failure?.at,
      };
    const stale =
      Boolean(failure) ||
      Date.now() - Date.parse(pointer.sourceUpdatedAt) > 36 * 60 * 60 * 1000;
    return {
      status: stale ? ("stale" as const) : ("healthy" as const),
      activeGeneration: pointer.activeSha,
      acceptedAt: pointer.acceptedAt,
      sourceUpdatedAt: pointer.sourceUpdatedAt,
      failureClass: failure?.class,
      failureAt: failure?.at,
    };
  } catch {
    return {
      status: "unavailable" as const,
      activeGeneration: runtimeActiveSha,
      acceptedAt: undefined,
      sourceUpdatedAt: undefined,
      failureClass: "configuration" as const,
      failureAt: undefined,
    };
  }
}

async function clearScheduleRuntimeForTests() {
  const retained = [
    explicitGeneration?.generation,
    runtimeActive,
    runtimePrevious,
  ];
  explicitGeneration = undefined;
  runtimeActive = undefined;
  runtimePrevious = undefined;
  runtimeActiveSha = undefined;
  runtimeDependencies = undefined;
  runtimeCheckedAt = 0;
  runtimeDiscovery = undefined;
  afterAcquireForTests = undefined;
  for (const loading of new Set(retained)) await retireGeneration(loading);
}

export async function resetScheduleRuntimeForTests(
  dependencies?: ScheduleRefreshDependencies,
) {
  await clearScheduleRuntimeForTests();
  runtimeDependencies = dependencies;
}

export async function installScheduleGenerationForTests(directory: string) {
  await clearScheduleRuntimeForTests();
  explicitGeneration = { directory };
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

async function rankingInstructorUuids(names: string[]) {
  try {
    const { resolveObservedInstructorNames } = await import(
      "@/lib/rankings/server"
    );
    return await resolveObservedInstructorNames(names);
  } catch {
    return new Map<string, string>();
  }
}

function collectSourceNames(rows: Array<Record<string, unknown>>) {
  const names: string[] = [];
  for (const row of rows) {
    for (const meeting of (row.schedules as NestedMeeting[] | undefined) ??
      []) {
      for (const value of (meeting.instructors as unknown[] | undefined) ??
        []) {
        const sourceName = text(value).trim();
        if (sourceName && sourceName.toLocaleLowerCase() !== "tba")
          names.push(sourceName);
      }
    }
  }
  return names;
}

async function mapRows(rows: Array<Record<string, unknown>>) {
  const instructors = await rankingInstructorUuids(collectSourceNames(rows));
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
        instructors: (
          (meeting.instructors as unknown[] | undefined) ?? []
        ).flatMap((value) => {
          const sourceName = text(value).trim();
          if (!sourceName || sourceName.toLocaleLowerCase() === "tba")
            return [];
          const uuid = instructors.get(sourceName);
          return [uuid ? { sourceName, uuid } : { sourceName }];
        }),
      }),
    );
    offering.classes.push({
      termCode: offering.termCode,
      coursePrefix: offering.coursePrefix,
      courseNumber: offering.courseNumber,
      courseCode: offering.courseCode,
      courseTitle: offering.title,
      courseDescription: offering.description,
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
  return withAcceptedGeneration(async (accepted) => {
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
      throw new InvalidScheduleQueryError(
        "Search is limited to 100 characters.",
      );
    const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 100);
    if (!Number.isFinite(limit))
      throw new InvalidScheduleQueryError("Invalid Schedule page size.");
    const rows = await queryRows(
      accepted.connection,
      `${offeringSql(accepted.directory)} WHERE course.term_code = $termCode ORDER BY course.prefix, course.number, class.section`,
      { termCode: term.termCode },
    );
    let offerings = await mapRows(rows);
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
  });
}

export async function getSchedule(
  entity: ScheduleEntity,
): Promise<ScheduleDetails> {
  return withAcceptedGeneration(async (accepted) => {
    if (entity.type === "instructor") {
      const instructorUuids = [
        ...new Set(entity.uuids.map(normalizeInstructorUuid)),
      ];
      if (
        instructorUuids.length === 0 ||
        instructorUuids.length > 100 ||
        instructorUuids.some((uuid) => uuid === undefined)
      )
        throw new InvalidScheduleQueryError("Invalid Instructor UUIDs.");
      const wanted = new Set(instructorUuids as string[]);
      let sourceNames: string[] = [];
      try {
        const { observedNamesForInstructorUuids } = await import(
          "@/lib/rankings/server"
        );
        sourceNames = (await observedNamesForInstructorUuids([...wanted])).map(
          (name) => name.trim().toLocaleLowerCase(),
        );
      } catch {
        sourceNames = [];
      }
      if (sourceNames.length === 0)
        return {
          type: "instructor",
          instructorUuids: [...wanted],
          classes: [],
        };
      const parameters = Object.fromEntries(
        sourceNames.map((sourceName, index) => [
          `sourceName${index}`,
          sourceName,
        ]),
      );
      const placeholders = sourceNames
        .map((_, index) => `$sourceName${index}`)
        .join(", ");
      const rows = await queryRows(
        accepted.connection,
        `${offeringSql(accepted.directory)} WHERE EXISTS (
          SELECT 1
          FROM unnest(class.schedules) AS schedules(meeting),
               unnest(meeting.instructors) AS instructors(name)
          WHERE lower(trim(name)) IN (${placeholders})
        ) ORDER BY course.term_num, course.prefix, course.number, class.section`,
        parameters,
      );
      return {
        type: "instructor",
        instructorUuids: [...wanted],
        classes: (await mapRows(rows)).flatMap((offering) => offering.classes),
      };
    }
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
    const offerings = await mapRows(rows);
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
  });
}

/** Resolve Classes and their accepted generation in one Schedule query boundary. */
export async function resolveClassesWithGeneration(
  term: string,
  classNumbers: ReadonlyArray<number>,
): Promise<{ generation: string; classes: ScheduleClass[] }> {
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
  return withAcceptedGeneration(async (accepted) => {
    const rows = await queryRows(
      accepted.connection,
      `${offeringSql(accepted.directory)} WHERE course.term_code = $termCode ORDER BY class.number`,
      { termCode },
    );
    if (
      rows.length === 0 &&
      !(await terms(accepted)).some((term) => term.termCode === termCode)
    )
      throw new InvalidScheduleQueryError("Unknown Term Code.");
    const wanted = new Set(numbers);
    const classes = (await mapRows(rows))
      .flatMap((offering) => offering.classes)
      .filter((scheduleClass) => wanted.has(scheduleClass.classNumber))
      .sort((left, right) => left.classNumber - right.classNumber);
    if (classes.length !== numbers.length)
      throw new InvalidScheduleQueryError("Unknown Class Number.");
    return { generation: accepted.sha, classes };
  });
}

export async function resolveClasses(
  term: string,
  classNumbers: ReadonlyArray<number>,
): Promise<ScheduleClass[]> {
  return (await resolveClassesWithGeneration(term, classNumbers)).classes;
}

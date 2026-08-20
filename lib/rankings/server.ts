import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type DuckDBConnection,
  DuckDBInstance,
  type DuckDBValue,
} from "@duckdb/node-api";

const SEED_SHA = "0699cb351bcd01cd2efc0cbf5c4ff479d2ff558d";
const ARTIFACTS = [
  "course-instructors.parquet",
  "course-rankings.parquet",
  "course-ratings.parquet",
  "instructor-rankings.parquet",
  "instructor-ratings.parquet",
] as const;
const CRITERIA = [
  "content",
  "teaching",
  "grading",
  "workload",
  "course",
  "instructor",
] as const;
type Criterion = (typeof CRITERIA)[number];

export type RankingPreset = "learning" | "grade";
export type RankingWeights = Partial<Record<Criterion, number>>;
export type CommonCoreCategory =
  | "critical-thinking-data-literacy"
  | "healthy-lifestyle-mindfulness-well-being"
  | "english-communication"
  | "chinese-communication"
  | "arts"
  | "humanities"
  | "science"
  | "technology"
  | "social-analysis"
  | "sustainability"
  | "undergraduate-research"
  | "undergraduate-teaching"
  | "undergraduate-participation"
  | "undergraduate-community";

export const COMMON_CORE_CATEGORIES: ReadonlyArray<{
  value: CommonCoreCategory;
  label: string;
  cc25Value: string;
}> = [
  {
    value: "critical-thinking-data-literacy",
    label: "Critical Thinking and Data Literacy",
    cc25Value: "33",
  },
  {
    value: "healthy-lifestyle-mindfulness-well-being",
    label: "Healthy Lifestyle, Mindfulness and Well-being",
    cc25Value: "34",
  },
  {
    value: "english-communication",
    label: "English Communication",
    cc25Value: "35",
  },
  {
    value: "chinese-communication",
    label: "Chinese Communication",
    cc25Value: "36",
  },
  { value: "arts", label: "Arts", cc25Value: "37" },
  { value: "humanities", label: "Humanities", cc25Value: "38" },
  { value: "science", label: "Science", cc25Value: "39" },
  { value: "technology", label: "Technology", cc25Value: "40" },
  { value: "social-analysis", label: "Social Analysis", cc25Value: "41" },
  { value: "sustainability", label: "Sustainability", cc25Value: "42" },
  {
    value: "undergraduate-research",
    label: "Undergraduate Research Opportunity",
    cc25Value: "43",
  },
  {
    value: "undergraduate-teaching",
    label: "Undergraduate Teaching Opportunity",
    cc25Value: "44",
  },
  {
    value: "undergraduate-participation",
    label: "Undergraduate Participation Opportunity",
    cc25Value: "45",
  },
  {
    value: "undergraduate-community",
    label: "Undergraduate Community Opportunity",
    cc25Value: "46",
  },
];

const commonCoreValues = new Map<CommonCoreCategory, string>(
  COMMON_CORE_CATEGORIES.map(({ value, cc25Value }) => [value, cc25Value]),
);

const PRESET_WEIGHTS: Record<
  "course" | "instructor",
  Record<RankingPreset, Record<Criterion, number>>
> = {
  course: {
    learning: {
      content: 0.2667,
      teaching: 0.2667,
      grading: 0.1,
      workload: 0.0333,
      course: 0.25,
      instructor: 0.0833,
    },
    grade: {
      content: 0.0667,
      teaching: 0.0667,
      grading: 0.4,
      workload: 0.1333,
      course: 0.25,
      instructor: 0.0833,
    },
  },
  instructor: {
    learning: {
      content: 0.2667,
      teaching: 0.2667,
      grading: 0.1,
      workload: 0.0333,
      course: 0.0833,
      instructor: 0.25,
    },
    grade: {
      content: 0.0667,
      teaching: 0.0667,
      grading: 0.4,
      workload: 0.1333,
      course: 0.0833,
      instructor: 0.25,
    },
  },
};

const ratingColumns = [
  ["term_num", "INTEGER"],
  ["term_code", "VARCHAR"],
  ["criterion", "VARCHAR"],
  ["rating", "DOUBLE"],
  ["bayesian", "DOUBLE"],
  ["confidence", "DOUBLE"],
  ["samples", "BIGINT"],
  ["cumulative_samples", "BIGINT"],
  ["effective_samples", "DOUBLE"],
  ["reliability", "DOUBLE"],
  ["posterior_stddev", "DOUBLE"],
] as const;
const schemas: Record<
  (typeof ARTIFACTS)[number],
  ReadonlyArray<readonly [string, string]>
> = {
  "course-instructors.parquet": [
    ["name", "VARCHAR"],
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["subject", "VARCHAR"],
    ["code", "VARCHAR"],
  ],
  "course-rankings.parquet": [
    ["subject", "VARCHAR"],
    ["code", "VARCHAR"],
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["is_offered", "BOOLEAN"],
    ...ratingColumns.slice(2),
  ],
  "course-ratings.parquet": [
    ["subject", "VARCHAR"],
    ["code", "VARCHAR"],
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["is_offered", "BOOLEAN"],
    ...ratingColumns.slice(2),
  ],
  "instructor-rankings.parquet": [
    ["name", "VARCHAR"],
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["is_teaching", "BOOLEAN"],
    ...ratingColumns.slice(2),
  ],
  "instructor-ratings.parquet": [
    ["name", "VARCHAR"],
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["is_teaching", "BOOLEAN"],
    ...ratingColumns.slice(2),
  ],
};

export type InstructorIdentity = {
  uuid: string;
  canonicalName: string;
  itsc?: string;
  aliases: Array<{
    name: string;
    source: "schedule" | "review" | "sfq" | "ranking-generation";
    sourceCommit: string;
    sourceFile?: "instructor-ratings.parquet";
  }>;
};

type Manifest = {
  schemaMajor: number;
  sourceCommit: string;
  artifacts: Record<string, { sha256: string; size: number }>;
  identities: InstructorIdentity[];
};

type Generation = {
  sha: string;
  directory: string;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  identitiesByCurrentName: Map<string, InstructorIdentity>;
  identitiesByObservedName: Map<string, InstructorIdentity[]>;
  identitiesByUuid: Map<string, InstructorIdentity>;
  currentNameByUuid: Map<string, string>;
  readers: number;
  retired: boolean;
  closed: boolean;
  cleanup?: () => Promise<void>;
};

export type GenerationPointer = {
  activeSha: string;
  previousSha?: string;
  acceptedAt: string;
  sourceUpdatedAt: string;
};

export type RankingFailure = {
  class:
    | "configuration"
    | "upstream"
    | "integrity"
    | "storage"
    | "lock"
    | "internal";
  at: string;
};

export type RankingRefreshDependencies = {
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
    readPointer(): Promise<GenerationPointer | undefined>;
    downloadGeneration(sha: string): Promise<string | undefined>;
    removeCachedGeneration?(sha: string): Promise<void>;
    putGeneration(sha: string, directory: string): Promise<void>;
    writePointer(pointer: GenerationPointer): Promise<void>;
    readFailure(): Promise<RankingFailure | undefined>;
    writeFailure(failure: RankingFailure | undefined): Promise<void>;
  };
  withLock<T>(operation: () => Promise<T>): Promise<T | undefined>;
  sleep(milliseconds: number): Promise<void>;
};

export type RankingRefreshResult = {
  status: "activated" | "current" | "superseded" | "busy";
  generation?: string;
};

export class RankingsRefreshError extends Error {
  readonly failureClass: RankingFailure["class"];

  constructor(
    failureClass: RankingFailure["class"],
    options?: { cause?: unknown },
  ) {
    super("Rankings refresh failed; last-known-good remains active.", options);
    this.name = "RankingsRefreshError";
    this.failureClass = failureClass;
  }
}

export type RankingsQuery = {
  entity: "course" | "instructor";
  termCode?: string;
  preset?: RankingPreset;
  weights?: RankingWeights;
  activity?: "current" | "all";
  search?: string;
  coursePrefix?: string;
  commonCore?: CommonCoreCategory[];
  course?: string;
  limit?: number;
  cursor?: string;
};

type RankFields = {
  score: number;
  globalRank: number;
  globalPopulation: number;
  globalPercentile: number;
  localRank: number;
  localPopulation: number;
  localPercentile: number;
};

export type InstructorRanking = RankFields & {
  entity: "instructor";
  uuid: string;
  canonicalName: string;
  itsc?: string;
};

export type CourseRanking = RankFields & {
  entity: "course";
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  title?: string;
  commonCore: CommonCoreCategory[];
};

export type RankingsPage<
  Entity extends "course" | "instructor" = "course" | "instructor",
> = {
  generation: string;
  population: {
    entity: Entity;
    termCode: string;
    activity: "current" | "all";
    size: number;
    filteredSize: number;
  };
  configuration: {
    preset: RankingPreset | "custom";
    weights: RankingWeights;
  };
  results: [Entity] extends ["course"]
    ? CourseRanking[]
    : [Entity] extends ["instructor"]
      ? InstructorRanking[]
      : Array<CourseRanking | InstructorRanking>;
  nextCursor?: string;
  unrankedMatchCount: number;
};

export type Rankings = {
  generation: string;
  population: RankingsPage["population"];
  instructor: InstructorIdentity;
  terms: Array<{
    termCode: string;
    criteria: Partial<Record<Criterion, { bayesian: number; samples: number }>>;
  }>;
  courses: Array<{ termCode: string; courseCode: string }>;
};

export class RankingsUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Rankings are unavailable.", options);
    this.name = "RankingsUnavailableError";
  }
}

export class InvalidRankingsQueryError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRankingsQueryError";
  }
}

export class StaleRankingsCursorError extends InvalidRankingsQueryError {
  constructor() {
    super("The ranking snapshot changed; restart pagination.");
    this.name = "StaleRankingsCursorError";
  }
}

const catalogs = new Map<string, Promise<CourseCatalog>>();
const queryQueues = new WeakMap<DuckDBConnection, Promise<void>>();
const queuedQueryCounts = new WeakMap<DuckDBConnection, number>();
const serializedQueries = new Map<string, string>();
let runtimeActive: Promise<Generation> | undefined;
let runtimePrevious: Promise<Generation> | undefined;
let runtimeActiveSha: string | undefined;
let runtimeCheckedAt = 0;
let runtimeDependencies: RankingRefreshDependencies | undefined;
let runtimeDiscovery: Promise<Generation> | undefined;
let explicitGeneration:
  | { directory: string; loading: Promise<Generation> }
  | undefined;
let seedLoading: Promise<Generation> | undefined;
let openGenerationCount = 0;
let afterAcquireForTests: ((generation: string) => Promise<void>) | undefined;

function seedDirectory() {
  return (
    process.env.RANKINGS_SEED_DIR ??
    resolve(process.cwd(), "rankings", "seed", SEED_SHA)
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
  if (queuedCount >= 8) throw new RankingsUnavailableError();
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
          reject(new RankingsUnavailableError());
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
    throw new Error("Unexpected ranking artifacts");
  if (
    manifest.schemaMajor !== 0 ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
    basename(resolve(directory)) !== manifest.sourceCommit
  ) {
    throw new Error("Invalid manifest");
  }
  if (
    JSON.stringify(Object.keys(manifest.artifacts).sort()) !==
    JSON.stringify(ARTIFACTS)
  ) {
    throw new Error("Manifest does not declare the complete generation");
  }

  await Promise.all(
    ARTIFACTS.map(async (filename) => {
      const path = resolve(directory, filename);
      const declaration = manifest.artifacts[filename];
      const bytes = await readFile(/* turbopackIgnore: true */ path);
      if (
        !declaration ||
        bytes.length !== declaration.size ||
        (await stat(/* turbopackIgnore: true */ path)).size !== declaration.size
      ) {
        throw new Error(`${filename} size mismatch`);
      }
      if (
        bytes.subarray(0, 4).toString() !== "PAR1" ||
        bytes.subarray(-4).toString() !== "PAR1"
      ) {
        throw new Error(`${filename} is not framed as Parquet`);
      }
      if (
        createHash("sha256").update(bytes).digest("hex") !== declaration.sha256
      ) {
        throw new Error(`${filename} checksum mismatch`);
      }
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

  const courses = sqlPath(directory, "course-ratings.parquet");
  const courseRanks = sqlPath(directory, "course-rankings.parquet");
  const instructors = sqlPath(directory, "instructor-ratings.parquet");
  const instructorRanks = sqlPath(directory, "instructor-rankings.parquet");
  const links = sqlPath(directory, "course-instructors.parquet");
  const checks = [
    `SELECT subject, code, term_num, criterion FROM read_parquet('${courses}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT subject, code, term_num, criterion FROM read_parquet('${courseRanks}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT name, term_num, criterion FROM read_parquet('${instructors}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT name, term_num, criterion FROM read_parquet('${instructorRanks}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT name, term_num, subject, code FROM read_parquet('${links}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT term_num FROM read_parquet(['${courses}', '${courseRanks}', '${instructors}', '${instructorRanks}', '${links}'], union_by_name=true) GROUP BY term_num HAVING count(DISTINCT term_code) <> 1`,
    `SELECT term_code FROM read_parquet(['${courses}', '${courseRanks}', '${instructors}', '${instructorRanks}', '${links}'], union_by_name=true) GROUP BY term_code HAVING count(DISTINCT term_num) <> 1`,
    `SELECT 1 FROM read_parquet('${courseRanks}') rankings LEFT JOIN read_parquet('${courses}') ratings USING (subject, code, term_num, term_code, criterion) WHERE ratings.subject IS NULL`,
    `SELECT 1 FROM read_parquet('${instructorRanks}') rankings LEFT JOIN read_parquet('${instructors}') ratings USING (name, term_num, term_code, criterion) WHERE ratings.name IS NULL`,
    `SELECT 1 FROM read_parquet(['${courses}', '${courseRanks}'], union_by_name=true) WHERE subject IS NULL OR code IS NULL OR term_num IS NULL OR term_code IS NULL OR is_offered IS NULL`,
    `SELECT 1 FROM read_parquet(['${instructors}', '${instructorRanks}'], union_by_name=true) WHERE name IS NULL OR term_num IS NULL OR term_code IS NULL OR is_teaching IS NULL`,
    `SELECT 1 FROM read_parquet('${links}') WHERE name IS NULL OR term_num IS NULL OR term_code IS NULL OR subject IS NULL OR code IS NULL`,
    `SELECT 1 FROM read_parquet(['${courses}', '${courseRanks}', '${instructors}', '${instructorRanks}'], union_by_name=true) WHERE criterion IS NULL OR criterion NOT IN ('content', 'teaching', 'grading', 'workload', 'course', 'instructor') OR rating IS NULL OR bayesian IS NULL OR confidence IS NULL OR samples IS NULL OR cumulative_samples IS NULL OR effective_samples IS NULL OR reliability IS NULL OR posterior_stddev IS NULL OR NOT isfinite(rating) OR NOT isfinite(bayesian) OR NOT isfinite(confidence) OR NOT isfinite(effective_samples) OR NOT isfinite(reliability) OR NOT isfinite(posterior_stddev)`,
    `SELECT 1 FROM read_parquet('${instructorRanks}') WHERE name = 'TBA' OR lower(trim(name)) = 'tba'`,
    `SELECT 1 FROM read_parquet('${links}') WHERE name = 'TBA' OR lower(trim(name)) = 'tba'`,
    `SELECT 1 WHERE (SELECT count(DISTINCT term_num) FROM read_parquet('${courseRanks}')) <> 1 OR (SELECT min(term_num) FROM read_parquet('${courseRanks}')) <> (SELECT max(term_num) FROM read_parquet('${courses}'))`,
    `SELECT 1 WHERE (SELECT count(DISTINCT term_num) FROM read_parquet('${instructorRanks}')) <> 1 OR (SELECT min(term_num) FROM read_parquet('${instructorRanks}')) <> (SELECT max(term_num) FROM read_parquet('${instructors}'))`,
  ];
  for (const check of checks) {
    if ((await queryRows(connection, `${check} LIMIT 1`)).length > 0)
      throw new Error("Ranking relation invariant failed");
  }

  const smokeQueries = [
    `SELECT subject, code FROM read_parquet('${courseRanks}') LIMIT 1`,
    `SELECT name FROM read_parquet('${instructorRanks}') LIMIT 1`,
    `SELECT term_code FROM read_parquet('${instructors}') ORDER BY term_num LIMIT 1`,
    `SELECT links.name FROM read_parquet('${links}') links JOIN read_parquet('${instructorRanks}') rankings USING (name, term_num) LIMIT 1`,
  ];
  for (const smokeQuery of smokeQueries) {
    if ((await queryRows(connection, smokeQuery)).length !== 1)
      throw new Error("Representative ranking query failed");
  }
}

function normalizedInstructorName(name: string) {
  return name.trim().toLocaleLowerCase();
}

function validateIdentities(manifest: Manifest, names: string[]) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const observedNames = new Map<string, InstructorIdentity[]>();
  const currentNames = new Map<string, InstructorIdentity>();
  const uuids = new Set<string>();
  const itscs = new Set<string>();
  const canonicalNames = new Set<string>();
  for (const identity of manifest.identities) {
    const canonicalName = identity.canonicalName?.trim().toLocaleLowerCase();
    const itsc = identity.itsc?.trim().toLocaleLowerCase();
    if (
      !uuidPattern.test(identity.uuid) ||
      uuids.has(identity.uuid) ||
      !canonicalName ||
      canonicalName === "tba" ||
      canonicalNames.has(canonicalName) ||
      (identity.itsc !== undefined &&
        (!itsc || !/^[a-z][a-z0-9._-]{1,31}$/.test(itsc) || itscs.has(itsc)))
    ) {
      throw new Error("Invalid Instructor identity");
    }
    uuids.add(identity.uuid);
    canonicalNames.add(canonicalName);
    if (itsc) {
      identity.itsc = itsc;
      itscs.add(itsc);
    }
    if (
      !Array.isArray(identity.aliases) ||
      identity.aliases.length === 0 ||
      identity.aliases.some((alias) => {
        const aliasName = alias.name?.trim().toLocaleLowerCase();
        return (
          !aliasName ||
          aliasName === "tba" ||
          !["schedule", "review", "sfq", "ranking-generation"].includes(
            alias.source,
          ) ||
          !/^[0-9a-f]{40}$/.test(alias.sourceCommit) ||
          (alias.source === "ranking-generation" &&
            alias.sourceFile !== "instructor-ratings.parquet")
        );
      })
    ) {
      throw new Error("Instructor aliases require source provenance");
    }
    for (const observedName of [
      identity.canonicalName,
      ...identity.aliases.map((alias) => alias.name),
    ]) {
      const normalized = normalizedInstructorName(observedName);
      const owners = observedNames.get(normalized) ?? [];
      if (!owners.some((owner) => owner.uuid === identity.uuid))
        owners.push(identity);
      observedNames.set(normalized, owners);
    }
    const currentObservedNames = [
      identity.canonicalName,
      ...identity.aliases
        .filter(
          (alias) =>
            alias.source === "ranking-generation" &&
            alias.sourceCommit === manifest.sourceCommit,
        )
        .map((alias) => alias.name),
    ];
    for (const observedName of currentObservedNames) {
      const normalized = normalizedInstructorName(observedName);
      const owner = currentNames.get(normalized);
      if (owner && owner.uuid !== identity.uuid)
        throw new Error("Current Instructor name is ambiguous");
      currentNames.set(normalized, identity);
    }
  }
  const currentNameByUuid = new Map<string, string>();
  for (const name of names) {
    const identity = currentNames.get(normalizedInstructorName(name));
    if (!identity)
      throw new Error("Instructor registry does not match the generation");
    const existing = currentNameByUuid.get(identity.uuid);
    if (existing && existing !== name)
      throw new Error("Instructor has several current ranking names");
    currentNameByUuid.set(identity.uuid, name);
  }
  return { currentNames, observedNames, currentNameByUuid };
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
      const nameRows = await queryRows(
        connection,
        `SELECT DISTINCT name FROM read_parquet('${sqlPath(directory, "instructor-ratings.parquet")}') ORDER BY name`,
      );
      const identityNames = validateIdentities(
        manifest,
        nameRows.map((row) => String(row.name)),
      );
      openGenerationCount += 1;
      return {
        sha: manifest.sourceCommit,
        directory,
        instance,
        connection,
        identitiesByCurrentName: identityNames.currentNames,
        identitiesByObservedName: identityNames.observedNames,
        identitiesByUuid: new Map(
          manifest.identities.map((identity) => [identity.uuid, identity]),
        ),
        currentNameByUuid: identityNames.currentNameByUuid,
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
    await cleanup?.().catch(() => undefined);
    throw new RankingsUnavailableError({ cause: error });
  }
}

async function closeRetiredGeneration(generation: Generation) {
  if (!generation.retired || generation.readers > 0 || generation.closed)
    return;
  generation.closed = true;
  generation.connection.closeSync();
  generation.instance.closeSync();
  openGenerationCount -= 1;
  await generation.cleanup?.().catch(() => undefined);
}

async function retireGeneration(loading?: Promise<Generation>) {
  if (!loading) return;
  try {
    const retired = await loading;
    retired.retired = true;
    await closeRetiredGeneration(retired);
  } catch {}
}

async function acquireGeneration(loading = generation()) {
  const accepted = await loading;
  if (accepted.closed) throw new RankingsUnavailableError();
  accepted.readers += 1;
  try {
    await afterAcquireForTests?.(accepted.sha);
  } catch (error) {
    accepted.readers -= 1;
    await closeRetiredGeneration(accepted);
    throw error;
  }
  return {
    accepted,
    async release() {
      accepted.readers -= 1;
      await closeRetiredGeneration(accepted);
    },
  };
}

function seedGeneration() {
  seedLoading ??= loadGeneration(seedDirectory());
  return seedLoading;
}

function explicitSeedGeneration(directory: string) {
  if (explicitGeneration?.directory !== directory) {
    void retireGeneration(explicitGeneration?.loading);
    explicitGeneration = { directory, loading: loadGeneration(directory) };
    serializedQueries.clear();
  }
  return explicitGeneration.loading;
}

async function installRuntimeGeneration(
  loading: Promise<Generation>,
  sha: string,
  previousSha?: string,
) {
  const accepted = await loading;
  if (accepted.sha !== sha) throw new RankingsUnavailableError();
  const oldActive = runtimeActive;
  const oldPrevious = runtimePrevious;
  runtimeActive = loading;
  runtimeActiveSha = sha;
  runtimePrevious = undefined;
  if (oldActive && oldActive !== seedLoading) {
    try {
      if ((await oldActive).sha === previousSha) runtimePrevious = oldActive;
      else await retireGeneration(oldActive);
    } catch {}
  }
  if (oldPrevious && oldPrevious !== runtimePrevious)
    await retireGeneration(oldPrevious);
}

async function discoverGeneration() {
  const existing = runtimeActive;
  try {
    runtimeDependencies ??= (
      await import("./runtime")
    ).productionRankingRefreshDependencies();
    const pointer = await runtimeDependencies.store.readPointer();
    if (pointer) {
      for (const sha of [pointer.activeSha, pointer.previousSha]) {
        if (!sha) continue;
        if (sha === runtimeActiveSha && runtimeActive) return runtimeActive;
        try {
          const directory =
            await runtimeDependencies.store.downloadGeneration(sha);
          if (!directory) continue;
          const removeCachedGeneration =
            runtimeDependencies.store.removeCachedGeneration?.bind(
              runtimeDependencies.store,
            );
          const loading = loadGeneration(
            directory,
            removeCachedGeneration
              ? () => removeCachedGeneration(sha)
              : undefined,
          );
          await installRuntimeGeneration(
            loading,
            sha,
            sha === pointer.activeSha ? pointer.previousSha : undefined,
          );
          return loading;
        } catch {
          // Try the retained previous generation before the validated seed.
        }
      }
    }
  } catch {
    if (existing) return existing;
  }
  if (existing) return existing;
  const seed = seedGeneration();
  runtimeActiveSha = (await seed).sha;
  return seed;
}

function generation() {
  if (process.env.RANKINGS_SEED_DIR)
    return explicitSeedGeneration(seedDirectory());
  if (explicitGeneration) {
    void retireGeneration(explicitGeneration.loading);
    explicitGeneration = undefined;
  }
  if (
    runtimeActive &&
    runtimeDependencies &&
    Date.now() - runtimeCheckedAt < 60_000
  )
    return runtimeActive;
  const storageConfigured =
    Boolean(runtimeDependencies) ||
    [
      "RANKINGS_SPACE_ENDPOINT",
      "RANKINGS_SPACE_BUCKET",
      "RANKINGS_SPACE_ACCESS_KEY_ID",
      "RANKINGS_SPACE_SECRET_ACCESS_KEY",
    ].every((name) => process.env[name]?.trim());
  if (!storageConfigured) return seedGeneration();
  if (runtimeActive && Date.now() - runtimeCheckedAt < 60_000)
    return runtimeActive;
  if (!runtimeDiscovery) {
    runtimeCheckedAt = Date.now();
    runtimeDiscovery = discoverGeneration().finally(() => {
      runtimeDiscovery = undefined;
    });
  }
  return runtimeDiscovery;
}

async function prepareCandidateManifest(
  candidate: {
    sha: string;
    directory: string;
    artifacts?: Record<string, { sha256: string; size: number }>;
  },
  current: GenerationPointer | undefined,
  dependencies: RankingRefreshDependencies,
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
  let previous: Generation;
  let closePrevious = false;
  if (current) {
    const directory = await dependencies.store.downloadGeneration(
      current.activeSha,
    );
    if (!directory)
      throw new Error("The current Instructor registry is unavailable");
    let retainedCurrent: Generation | undefined;
    for (const loading of [runtimeActive, runtimePrevious]) {
      if (!loading) continue;
      try {
        const retainedGeneration = await loading;
        if (
          retainedGeneration.sha === current.activeSha &&
          retainedGeneration.directory === directory &&
          !retainedGeneration.closed
        ) {
          retainedCurrent = retainedGeneration;
          break;
        }
      } catch {}
    }
    if (retainedCurrent) previous = retainedCurrent;
    else {
      const removeCachedGeneration =
        dependencies.store.removeCachedGeneration?.bind(dependencies.store);
      previous = await loadGeneration(
        directory,
        removeCachedGeneration
          ? () => removeCachedGeneration(current.activeSha)
          : undefined,
      );
      closePrevious = true;
    }
    if (previous.sha !== current.activeSha) {
      if (closePrevious) await retireGeneration(Promise.resolve(previous));
      throw new Error(
        "The current Instructor registry does not match its pointer",
      );
    }
  } else {
    previous = await seedGeneration();
  }
  const retained = structuredClone([...previous.identitiesByUuid.values()]);
  try {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    let names: string[];
    try {
      const rows = await queryRows(
        connection,
        `SELECT DISTINCT name FROM read_parquet('${sqlPath(candidate.directory, "instructor-ratings.parquet")}') ORDER BY name`,
      );
      names = rows.map((row) => String(row.name));
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
    for (const name of names) {
      const normalized = normalizedInstructorName(name);
      const matches = retained.filter(
        (identity) =>
          normalizedInstructorName(identity.canonicalName) === normalized ||
          identity.aliases.some(
            (alias) =>
              alias.source === "ranking-generation" &&
              alias.sourceCommit === previous?.sha &&
              normalizedInstructorName(alias.name) === normalized,
          ),
      );
      if (matches.length > 1)
        throw new Error("Current Instructor name is ambiguous");
      const identity = matches[0];
      if (identity) {
        identity.aliases.push({
          name,
          source: "ranking-generation",
          sourceCommit: candidate.sha,
          sourceFile: "instructor-ratings.parquet",
        });
      } else {
        retained.push({
          uuid: randomUUID(),
          canonicalName: name,
          aliases: [
            {
              name,
              source: "ranking-generation",
              sourceCommit: candidate.sha,
              sourceFile: "instructor-ratings.parquet",
            },
          ],
        });
      }
    }
    await writeFile(
      resolve(candidate.directory, "manifest.json"),
      `${JSON.stringify(
        {
          schemaMajor: 0,
          sourceCommit: candidate.sha,
          artifacts: candidate.artifacts,
          identities: retained,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  } finally {
    if (closePrevious) await retireGeneration(Promise.resolve(previous));
  }
}

export async function refreshRankings(
  options: { sha?: string },
  dependencies: RankingRefreshDependencies,
): Promise<RankingRefreshResult> {
  if (options.sha !== undefined && !/^[0-9a-f]{40}$/.test(options.sha))
    throw new InvalidRankingsQueryError(
      "A full immutable commit SHA is required.",
    );
  let result: RankingRefreshResult | undefined;
  try {
    result = await dependencies.withLock(async () => {
      const current = await dependencies.store.readPointer();
      if (options.sha && current?.activeSha === options.sha)
        return { status: "current", generation: options.sha } as const;
      let lastError: unknown;
      let failureClass: RankingFailure["class"] = "upstream";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) await dependencies.sleep(250 * 4 ** (attempt - 1));
        let candidate:
          | Awaited<ReturnType<typeof dependencies.upstream.download>>
          | undefined;
        let loading: Promise<Generation> | undefined;
        try {
          candidate = await dependencies.upstream.download(options.sha);
          failureClass = "integrity";
          if (!/^[0-9a-f]{40}$/.test(candidate.sha))
            throw new Error(
              "Upstream did not resolve to a full immutable commit SHA",
            );
          if (options.sha && candidate.sha !== options.sha)
            throw new Error(
              "Upstream generation does not match the requested commit",
            );
          if (!Number.isFinite(Date.parse(candidate.sourceUpdatedAt)))
            throw new Error("Upstream publication time is invalid");
          await prepareCandidateManifest(candidate, current, dependencies);
          const temporaryRoot = candidate.temporary
            ? resolve(candidate.directory, "..")
            : undefined;
          loading = loadGeneration(
            candidate.directory,
            temporaryRoot
              ? () =>
                  rm(temporaryRoot, {
                    recursive: true,
                    force: true,
                  })
              : undefined,
          );
          const accepted = await loading;
          if (accepted.sha !== candidate.sha)
            throw new Error("Candidate files are from a mixed commit");
          if (
            current &&
            Date.parse(candidate.sourceUpdatedAt) <=
              Date.parse(current.sourceUpdatedAt)
          ) {
            await retireGeneration(loading);
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
          runtimeCheckedAt = Date.now();
          runtimeDependencies = dependencies;
          await dependencies.store
            .writeFailure(undefined)
            .catch(() => undefined);
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
            failureClass = error.failureClass as RankingFailure["class"];
          if (loading) await retireGeneration(loading);
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
      } as const;
      try {
        await dependencies.store.writeFailure(failure);
      } catch {
        // The active pointer is deliberately untouched even when health storage fails.
      }
      throw new RankingsRefreshError(failureClass, { cause: lastError });
    });
  } catch (error) {
    if (error instanceof RankingsRefreshError) throw error;
    const failure = { class: "lock", at: new Date().toISOString() } as const;
    await dependencies.store.writeFailure(failure).catch(() => undefined);
    throw new RankingsRefreshError("lock", { cause: error });
  }
  return result ?? { status: "busy" };
}

export async function getRankingsHealth(
  dependencies?: RankingRefreshDependencies,
) {
  try {
    const selected =
      dependencies ??
      runtimeDependencies ??
      (await import("./runtime")).productionRankingRefreshDependencies();
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

export function getRankingsRuntimeStatsForTests() {
  return { openGenerations: openGenerationCount };
}

export function setRankingsAfterAcquireForTests(
  hook?: (generation: string) => Promise<void>,
) {
  afterAcquireForTests = hook;
}

export async function resetRankingsRuntimeForTests(
  dependencies?: RankingRefreshDependencies,
) {
  const retained = [
    runtimeActive,
    runtimePrevious,
    explicitGeneration?.loading,
    seedLoading,
  ];
  runtimeActive = undefined;
  runtimePrevious = undefined;
  explicitGeneration = undefined;
  seedLoading = undefined;
  runtimeActiveSha = undefined;
  runtimeCheckedAt = 0;
  runtimeDependencies = dependencies;
  runtimeDiscovery = undefined;
  afterAcquireForTests = undefined;
  serializedQueries.clear();
  catalogs.clear();
  await Promise.all(retained.map((loading) => retireGeneration(loading)));
}

function number(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

type CatalogCourse = {
  coursePrefix: string;
  courseNumber: string;
  courseName: string;
  courseAttributes: Array<{
    courseAttribute: string;
    courseAttributeValue: string;
  }>;
};

type CourseCatalog = {
  courses: Map<string, CatalogCourse>;
  digest: string;
};

type Candidate = {
  key: string;
  score?: number;
  searchText: string;
  coursePrefix?: string;
  courseCodes: Set<string>;
  commonCore: CommonCoreCategory[];
  result:
    | Omit<CourseRanking, keyof RankFields | "commonCore">
    | Omit<InstructorRanking, keyof RankFields>;
};

type RankedCandidate = Candidate & { score: number };

async function courseCatalog(directory: string) {
  const configuredPath = process.env.RANKINGS_COURSE_CATALOG_FILE;
  const paths = configuredPath
    ? [resolve(configuredPath)]
    : [
        resolve(directory, "..", "course-catalog.json"),
        resolve(process.cwd(), "data", "data-course-catalog.json"),
      ];
  const cacheKey = paths.join("\0");
  let loading = catalogs.get(cacheKey);
  if (!loading) {
    loading = (async () => {
      let contents: Buffer | undefined;
      for (const path of paths) {
        try {
          contents = await readFile(/* turbopackIgnore: true */ path);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (!contents) throw new Error("Course catalog is unavailable");
      const parsed = JSON.parse(contents.toString("utf8")) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0)
        throw new Error("Invalid Course catalog");
      const courses = new Map<string, CatalogCourse>();
      for (const value of parsed) {
        if (
          typeof value !== "object" ||
          value === null ||
          !("coursePrefix" in value) ||
          typeof value.coursePrefix !== "string" ||
          !/^[A-Z]{2,8}$/.test(value.coursePrefix) ||
          !("courseNumber" in value) ||
          typeof value.courseNumber !== "string" ||
          !/^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(value.courseNumber) ||
          !("courseName" in value) ||
          typeof value.courseName !== "string" ||
          !value.courseName.trim() ||
          !("courseAttributes" in value) ||
          !Array.isArray(value.courseAttributes) ||
          value.courseAttributes.some(
            (attribute) =>
              typeof attribute !== "object" ||
              attribute === null ||
              !("courseAttribute" in attribute) ||
              typeof attribute.courseAttribute !== "string" ||
              !attribute.courseAttribute.trim() ||
              !("courseAttributeValue" in attribute) ||
              typeof attribute.courseAttributeValue !== "string" ||
              !attribute.courseAttributeValue.trim(),
          )
        ) {
          throw new Error("Invalid Course catalog entry");
        }
        const course = value as CatalogCourse;
        const key = `${course.coursePrefix}${course.courseNumber}`;
        if (courses.has(key)) throw new Error("Duplicate Course catalog entry");
        courses.set(key, course);
      }
      return {
        courses,
        digest: createHash("sha256").update(contents).digest("base64url"),
      };
    })();
    catalogs.set(cacheKey, loading);
    if (catalogs.size > 3)
      catalogs.delete(catalogs.keys().next().value as string);
  }
  return loading;
}

function normalizedWeights(query: RankingsQuery) {
  if (query.weights !== undefined) {
    const entries = Object.entries(query.weights);
    if (
      entries.some(
        ([criterion, value]) =>
          !CRITERIA.includes(criterion as Criterion) ||
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0,
      )
    ) {
      throw new InvalidRankingsQueryError(
        "Custom ranking weights must be finite and non-negative.",
      );
    }
    const positive = entries
      .filter((entry) => entry[1] > 0)
      .sort(
        ([left], [right]) =>
          CRITERIA.indexOf(left as Criterion) -
          CRITERIA.indexOf(right as Criterion),
      ) as Array<[Criterion, number]>;
    const maximum = Math.max(...positive.map((entry) => entry[1]));
    if (positive.length === 0)
      throw new InvalidRankingsQueryError(
        "Custom ranking weights need at least one non-zero criterion.",
      );
    const scaled = positive
      .map(([criterion, value]) => [criterion, value / maximum] as const)
      .filter((entry) => entry[1] > 0);
    const total = scaled.reduce((sum, entry) => sum + entry[1], 0);
    return {
      preset: "custom" as const,
      weights: Object.fromEntries(
        scaled.map(([criterion, value]) => [criterion, value / total]),
      ) as RankingWeights,
    };
  }
  const preset = query.preset ?? "learning";
  if (preset !== "learning" && preset !== "grade")
    throw new InvalidRankingsQueryError("Unknown Ranking Preset.");
  return { preset, weights: PRESET_WEIGHTS[query.entity][preset] };
}

function percentile(rank: number, population: number) {
  return population === 1 ? 1 : (population - rank) / (population - 1);
}

function ranks(candidates: RankedCandidate[]) {
  let rank = 0;
  let previousScore: number | undefined;
  return new Map(
    candidates.map((candidate, index) => {
      if (candidate.score !== previousScore) rank = index + 1;
      previousScore = candidate.score;
      return [
        candidate.key,
        {
          rank,
          population: candidates.length,
          percentile: percentile(rank, candidates.length),
        },
      ];
    }),
  );
}

function decodeCursor(cursor: string) {
  try {
    if (cursor.length > 2048) throw new Error("cursor too long");
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof value.g !== "string" ||
      typeof value.c !== "string" ||
      typeof value.q !== "string" ||
      typeof value.p !== "string"
    )
      throw new Error("invalid cursor payload");
    return value as { g: string; c: string; q: string; p: string };
  } catch {
    throw new InvalidRankingsQueryError("Invalid ranking cursor.");
  }
}

export function queryRankings(
  query: RankingsQuery & { entity: "course" },
): Promise<RankingsPage<"course">>;
export function queryRankings(
  query: RankingsQuery & { entity: "instructor" },
): Promise<RankingsPage<"instructor">>;
export function queryRankings(query: RankingsQuery): Promise<RankingsPage>;
export async function queryRankings(
  query: RankingsQuery,
): Promise<RankingsPage> {
  const lease = await acquireGeneration();
  try {
    return await queryRankingsWithGeneration(query, lease.accepted);
  } finally {
    await lease.release();
  }
}

async function queryRankingsWithGeneration(
  query: RankingsQuery,
  accepted: Generation,
): Promise<RankingsPage> {
  if (query.entity !== "course" && query.entity !== "instructor")
    throw new InvalidRankingsQueryError("Unknown ranking entity.");
  const activity = query.activity ?? "current";
  if (activity !== "current" && activity !== "all")
    throw new InvalidRankingsQueryError("Invalid activity mode.");
  const search = query.search?.trim().toLocaleLowerCase() || undefined;
  if (search && search.length > 100)
    throw new InvalidRankingsQueryError("Search is limited to 100 characters.");
  const coursePrefix = query.coursePrefix?.trim().toUpperCase() || undefined;
  if (coursePrefix && !/^[A-Z]{2,8}$/.test(coursePrefix))
    throw new InvalidRankingsQueryError("Invalid Course Prefix.");
  const course = query.course?.trim().toUpperCase() || undefined;
  if (course && !/^[A-Z]{2,8} [0-9]{3,5}[A-Z]?$/.test(course))
    throw new InvalidRankingsQueryError("Invalid Course Code.");
  const commonCore = [...new Set(query.commonCore ?? [])].sort();
  if (commonCore.some((category) => !commonCoreValues.has(category)))
    throw new InvalidRankingsQueryError("Invalid Common Core category.");
  if (
    (query.entity === "course" && course) ||
    (query.entity === "instructor" && commonCore.length > 0)
  )
    throw new InvalidRankingsQueryError(
      "Filter does not apply to this entity.",
    );
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 100);
  if (!Number.isFinite(limit))
    throw new InvalidRankingsQueryError("Invalid ranking page size.");
  const configuration = normalizedWeights(query);
  const entityFile = `${query.entity}-ratings.parquet` as const;
  const rankingFile = `${query.entity}-rankings.parquet` as const;
  const source = sqlPath(accepted.directory, entityFile);
  const latest = await queryRows(
    accepted.connection,
    `SELECT term_code FROM read_parquet('${sqlPath(accepted.directory, rankingFile)}') LIMIT 1`,
  );
  const termCode = query.termCode?.trim() || String(latest[0]?.term_code);
  if (!/^[0-9]{4}$/.test(termCode))
    throw new InvalidRankingsQueryError("Invalid Term Code.");
  const termExists = await queryRows(
    accepted.connection,
    `SELECT 1 FROM read_parquet('${source}') WHERE term_code = $termCode LIMIT 1`,
    { termCode },
  );
  if (termExists.length === 0)
    throw new InvalidRankingsQueryError("Unknown Term Code.");

  let catalogSnapshot: CourseCatalog | undefined;
  if (query.entity === "course" || search) {
    try {
      catalogSnapshot = await courseCatalog(accepted.directory);
    } catch (error) {
      throw new RankingsUnavailableError({ cause: error });
    }
  }
  const catalog = catalogSnapshot?.courses ?? new Map<string, CatalogCourse>();
  const catalogDigest = catalogSnapshot?.digest ?? "";
  const linkRows = await queryRows(
    accepted.connection,
    `SELECT name, subject, code FROM read_parquet('${sqlPath(accepted.directory, "course-instructors.parquet")}') WHERE term_code = $termCode`,
    { termCode },
  );
  const identitiesByCourse = new Map<string, InstructorIdentity[]>();
  const coursesByInstructor = new Map<string, Set<string>>();
  for (const row of linkRows) {
    const courseKey = `${row.subject}${row.code}`;
    const observed = accepted.identitiesByObservedName.get(
      normalizedInstructorName(String(row.name)),
    );
    const identity = observed?.length === 1 ? observed[0] : undefined;
    if (identity) {
      const identities = identitiesByCourse.get(courseKey) ?? [];
      identities.push(identity);
      identitiesByCourse.set(courseKey, identities);
    }
    const courses = coursesByInstructor.get(String(row.name)) ?? new Set();
    courses.add(`${row.subject} ${row.code}`);
    coursesByInstructor.set(String(row.name), courses);
  }

  const entityColumns = query.entity === "course" ? "subject, code" : "name";
  const activityColumn =
    query.entity === "course" ? "is_offered" : "is_teaching";
  const rows = await queryRows(
    accepted.connection,
    `SELECT ${entityColumns}, criterion, bayesian FROM read_parquet('${source}') WHERE term_code = $termCode AND ($current = false OR ${activityColumn}) ORDER BY ${entityColumns}, criterion`,
    { termCode, current: activity === "current" },
  );
  const evidence = new Map<string, Partial<Record<Criterion, number>>>();
  for (const row of rows) {
    const criterion = String(row.criterion) as Criterion;
    if (!CRITERIA.includes(criterion)) continue;
    const key =
      query.entity === "course"
        ? `${row.subject}${row.code}`
        : String(row.name);
    const values = evidence.get(key) ?? {};
    values[criterion] = number(row.bayesian);
    evidence.set(key, values);
  }

  const weightedCriteria = Object.keys(configuration.weights) as Criterion[];
  const candidates: Candidate[] = [];
  for (const [key, values] of evidence) {
    const score = weightedCriteria.some(
      (criterion) => values[criterion] === undefined,
    )
      ? undefined
      : weightedCriteria.reduce(
          (sum, criterion) =>
            sum +
            (values[criterion] as number) *
              (configuration.weights[criterion] as number),
          0,
        );
    if (query.entity === "course") {
      const prefix = key.match(/^[A-Z]+/)?.[0];
      const courseNumber = prefix ? key.slice(prefix.length) : "";
      if (!prefix || !courseNumber) continue;
      const metadata = catalog.get(key);
      const categories = COMMON_CORE_CATEGORIES.filter(
        ({ value }) =>
          metadata?.courseAttributes?.some(
            (attribute) =>
              attribute.courseAttribute === "CC25" &&
              attribute.courseAttributeValue === commonCoreValues.get(value),
          ) ?? false,
      ).map(({ value }) => value);
      const associated = identitiesByCourse.get(key) ?? [];
      candidates.push({
        key,
        score,
        coursePrefix: prefix,
        courseCodes: new Set([`${prefix} ${courseNumber}`]),
        commonCore: categories,
        searchText: [
          prefix,
          courseNumber,
          `${prefix} ${courseNumber}`,
          metadata?.courseName,
          ...associated.flatMap((identity) => [
            identity.uuid,
            identity.canonicalName,
            identity.itsc,
            ...identity.aliases.map((alias) => alias.name),
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase(),
        result: {
          entity: "course",
          coursePrefix: prefix,
          courseNumber,
          courseCode: `${prefix} ${courseNumber}`,
          title: metadata?.courseName,
        },
      });
    } else {
      const identity = accepted.identitiesByCurrentName.get(
        normalizedInstructorName(key),
      );
      if (!identity) continue;
      const courseCodes = coursesByInstructor.get(key) ?? new Set();
      candidates.push({
        key: identity.uuid,
        score,
        courseCodes,
        commonCore: [],
        searchText: [
          identity.uuid,
          identity.canonicalName,
          identity.itsc,
          ...identity.aliases.map((alias) => alias.name),
          ...[...courseCodes].flatMap((courseCode) => {
            const [prefix, courseNumber] = courseCode.split(" ");
            return [
              courseCode,
              catalog.get(`${prefix}${courseNumber}`)?.courseName,
            ];
          }),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase(),
        result: {
          entity: "instructor",
          uuid: identity.uuid,
          canonicalName: identity.canonicalName,
          itsc: identity.itsc,
        },
      });
    }
  }
  const eligible = candidates.filter(
    (candidate): candidate is RankedCandidate => candidate.score !== undefined,
  );
  eligible.sort(
    (left, right) =>
      right.score - left.score || left.key.localeCompare(right.key),
  );
  const matchesFilters = (candidate: Candidate) => {
    if (coursePrefix) {
      const matchesPrefix =
        query.entity === "course"
          ? candidate.coursePrefix === coursePrefix
          : [...candidate.courseCodes].some((code) =>
              code.startsWith(`${coursePrefix} `),
            );
      if (!matchesPrefix) return false;
    }
    if (course && !candidate.courseCodes.has(course)) return false;
    if (
      commonCore.length > 0 &&
      !commonCore.some((category) => candidate.commonCore.includes(category))
    )
      return false;
    return true;
  };
  const globalRanks = ranks(eligible);
  const filtered = eligible.filter(matchesFilters);
  const localRanks = ranks(filtered);
  const searched = search
    ? filtered.filter((candidate) => candidate.searchText.includes(search))
    : filtered;
  const unrankedMatchCount = candidates.filter(
    (candidate) =>
      candidate.score === undefined &&
      matchesFilters(candidate) &&
      (!search || candidate.searchText.includes(search)),
  ).length;

  const normalizedQuery = JSON.stringify({
    entity: query.entity,
    termCode,
    activity,
    search,
    coursePrefix,
    commonCore,
    course,
    configuration,
    limit,
  });
  const fingerprint = createHash("sha256")
    .update(normalizedQuery)
    .digest("base64url");
  const cacheKey = `${accepted.sha}:${catalogDigest}:${fingerprint}:${query.cursor ?? ""}`;
  const cached = serializedQueries.get(cacheKey);
  if (cached) return JSON.parse(cached) as RankingsPage;
  let start = 0;
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    if (cursor.g !== accepted.sha) throw new StaleRankingsCursorError();
    if (cursor.q !== fingerprint)
      throw new InvalidRankingsQueryError(
        "The cursor belongs to a different ranking query.",
      );
    if (cursor.c !== catalogDigest) throw new StaleRankingsCursorError();
    const position = searched.findIndex(
      (candidate) => candidate.key === cursor.p,
    );
    if (position < 0)
      throw new InvalidRankingsQueryError("Invalid ranking cursor position.");
    start = position + 1;
  }
  const page = searched.slice(start, start + limit);
  const results = page.map((candidate) => {
    const global = globalRanks.get(candidate.key);
    const local = localRanks.get(candidate.key);
    if (!global || !local) throw new Error("Missing rank");
    return {
      ...candidate.result,
      commonCore:
        candidate.result.entity === "course" ? candidate.commonCore : undefined,
      score: candidate.score,
      globalRank: global.rank,
      globalPopulation: global.population,
      globalPercentile: global.percentile,
      localRank: local.rank,
      localPopulation: local.population,
      localPercentile: local.percentile,
    } as CourseRanking | InstructorRanking;
  });
  const hasMore = start + page.length < searched.length;
  const nextCursor = hasMore
    ? Buffer.from(
        JSON.stringify({
          g: accepted.sha,
          c: catalogDigest,
          q: fingerprint,
          p: page.at(-1)?.key,
        }),
      ).toString("base64url")
    : undefined;
  const response: RankingsPage = {
    generation: accepted.sha,
    population: {
      entity: query.entity,
      termCode,
      activity,
      size: eligible.length,
      filteredSize: filtered.length,
    },
    configuration,
    results,
    nextCursor,
    unrankedMatchCount,
  };
  serializedQueries.set(cacheKey, JSON.stringify(response));
  if (serializedQueries.size > 256)
    serializedQueries.delete(serializedQueries.keys().next().value as string);
  return response;
}

export async function getRankings(
  entity: { type: "instructor"; uuid: string },
  options: { activity?: "current" | "all" } = {},
): Promise<Rankings> {
  const lease = await acquireGeneration();
  const accepted = lease.accepted;
  try {
    const instructor = accepted.identitiesByUuid.get(entity.uuid.toLowerCase());
    if (entity.type !== "instructor" || !instructor)
      throw new TypeError("Unknown Instructor");
    const page = await queryRankingsWithGeneration(
      {
        entity: "instructor",
        activity: options.activity,
      },
      accepted,
    );
    const ratings = await queryRows(
      accepted.connection,
      `SELECT term_code, criterion, bayesian, samples FROM read_parquet('${sqlPath(accepted.directory, "instructor-ratings.parquet")}') WHERE name = $name ORDER BY term_num, criterion`,
      {
        name:
          accepted.currentNameByUuid.get(instructor.uuid) ??
          instructor.canonicalName,
      },
    );
    const terms = new Map<string, Rankings["terms"][number]>();
    for (const row of ratings) {
      const termCode = String(row.term_code);
      const term = terms.get(termCode) ?? { termCode, criteria: {} };
      term.criteria[String(row.criterion) as Criterion] = {
        bayesian: number(row.bayesian),
        samples: number(row.samples),
      };
      terms.set(termCode, term);
    }
    const courses = await queryRows(
      accepted.connection,
      `SELECT term_code, subject || ' ' || code AS course_code FROM read_parquet('${sqlPath(accepted.directory, "course-instructors.parquet")}') WHERE name = $name ORDER BY term_num, subject, code`,
      {
        name:
          accepted.currentNameByUuid.get(instructor.uuid) ??
          instructor.canonicalName,
      },
    );
    return {
      generation: accepted.sha,
      population: page.population,
      instructor,
      terms: [...terms.values()],
      courses: courses.map((row) => ({
        termCode: String(row.term_code),
        courseCode: String(row.course_code),
      })),
    };
  } finally {
    await lease.release();
  }
}

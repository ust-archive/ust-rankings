import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
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
}> = [
  {
    value: "critical-thinking-data-literacy",
    label: "Critical Thinking and Data Literacy",
  },
  {
    value: "healthy-lifestyle-mindfulness-well-being",
    label: "Healthy Lifestyle, Mindfulness and Well-being",
  },
  { value: "english-communication", label: "English Communication" },
  { value: "chinese-communication", label: "Chinese Communication" },
  { value: "arts", label: "Arts" },
  { value: "humanities", label: "Humanities" },
  { value: "science", label: "Science" },
  { value: "technology", label: "Technology" },
  { value: "social-analysis", label: "Social Analysis" },
  { value: "sustainability", label: "Sustainability" },
  {
    value: "undergraduate-research",
    label: "Undergraduate Research Opportunity",
  },
  {
    value: "undergraduate-teaching",
    label: "Undergraduate Teaching Opportunity",
  },
  {
    value: "undergraduate-participation",
    label: "Undergraduate Participation Opportunity",
  },
  {
    value: "undergraduate-community",
    label: "Undergraduate Community Opportunity",
  },
];

const commonCoreValues = new Map<CommonCoreCategory, string>(
  COMMON_CORE_CATEGORIES.map(({ value }, index) => [value, String(index + 33)]),
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
  connection: DuckDBConnection;
  identitiesByName: Map<string, InstructorIdentity>;
  identitiesByUuid: Map<string, InstructorIdentity>;
};

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
    super("The ranking generation changed; restart pagination.");
    this.name = "StaleRankingsCursorError";
  }
}

const generations = new Map<string, Promise<Generation>>();
const catalogs = new Map<string, Promise<Map<string, CatalogCourse>>>();

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
  const reader = await connection.runAndReadAll(sql, parameters);
  return reader.getRowObjectsJS() as Array<Record<string, unknown>>;
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

function validateIdentities(manifest: Manifest, names: string[]) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const sortedNames = [...names].sort();
  if (
    JSON.stringify(
      manifest.identities.map((identity) => identity.canonicalName).sort(),
    ) !== JSON.stringify(sortedNames)
  ) {
    throw new Error("Instructor registry does not match the generation");
  }
  const uuids = new Set<string>();
  const itscs = new Set<string>();
  for (const identity of manifest.identities) {
    const canonicalName = identity.canonicalName?.trim().toLocaleLowerCase();
    const itsc = identity.itsc?.trim().toLocaleLowerCase();
    if (
      !uuidPattern.test(identity.uuid) ||
      uuids.has(identity.uuid) ||
      !canonicalName ||
      canonicalName === "tba" ||
      (identity.itsc !== undefined &&
        (!itsc || !/^[a-z][a-z0-9._-]{1,31}$/.test(itsc) || itscs.has(itsc)))
    ) {
      throw new Error("Invalid Instructor identity");
    }
    uuids.add(identity.uuid);
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
          alias.sourceCommit !== manifest.sourceCommit ||
          (alias.source === "ranking-generation" &&
            alias.sourceFile !== "instructor-ratings.parquet")
        );
      })
    ) {
      throw new Error("Instructor aliases require source provenance");
    }
  }
}

async function loadGeneration(directory: string): Promise<Generation> {
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
      validateIdentities(
        manifest,
        nameRows.map((row) => String(row.name)),
      );
      return {
        sha: manifest.sourceCommit,
        directory,
        connection,
        identitiesByName: new Map(
          manifest.identities.map((identity) => [
            identity.canonicalName,
            identity,
          ]),
        ),
        identitiesByUuid: new Map(
          manifest.identities.map((identity) => [identity.uuid, identity]),
        ),
      };
    } catch (error) {
      connection.closeSync();
      instance.closeSync();
      throw error;
    }
  } catch (error) {
    throw new RankingsUnavailableError({ cause: error });
  }
}

function generation() {
  const directory = seedDirectory();
  let loading = generations.get(directory);
  if (!loading) {
    loading = loadGeneration(directory);
    generations.set(directory, loading);
  }
  return loading;
}

function number(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

type CatalogCourse = {
  coursePrefix: string;
  courseNumber: string;
  courseName?: string;
  courseAttributes?: Array<{
    courseAttribute: string;
    courseAttributeValue: string;
  }>;
};

type Candidate = {
  key: string;
  score: number;
  searchText: string;
  coursePrefix?: string;
  courseCodes: Set<string>;
  commonCore: CommonCoreCategory[];
  result:
    | Omit<CourseRanking, keyof RankFields | "commonCore">
    | Omit<InstructorRanking, keyof RankFields>;
};

async function courseCatalog(directory: string) {
  let loading = catalogs.get(directory);
  if (!loading) {
    loading = (async () => {
      let contents: string | undefined;
      for (const path of [
        resolve(directory, "..", "course-catalog.json"),
        resolve(process.cwd(), "data", "data-course-catalog.json"),
      ]) {
        try {
          contents = await readFile(/* turbopackIgnore: true */ path, "utf8");
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (!contents) return new Map<string, CatalogCourse>();
      const courses = JSON.parse(contents) as CatalogCourse[];
      if (!Array.isArray(courses)) throw new Error("Invalid Course catalog");
      return new Map(
        courses.map((course) => [
          `${course.coursePrefix}${course.courseNumber}`,
          course,
        ]),
      );
    })();
    catalogs.set(directory, loading);
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
    const positive = entries.filter((entry) => entry[1] > 0) as Array<
      [Criterion, number]
    >;
    const total = positive.reduce((sum, entry) => sum + entry[1], 0);
    if (total === 0)
      throw new InvalidRankingsQueryError(
        "Custom ranking weights need at least one non-zero criterion.",
      );
    return {
      preset: "custom" as const,
      weights: Object.fromEntries(
        positive.map(([criterion, value]) => [criterion, value / total]),
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

function ranks(candidates: Candidate[]) {
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
      typeof value.q !== "string" ||
      typeof value.p !== "string"
    )
      throw new Error("invalid cursor payload");
    return value as { g: string; q: string; p: string };
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
  if (course && !/^[A-Z]{2,8} [0-9]{3,5}$/.test(course))
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
  const accepted = await generation();
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

  let catalog: Map<string, CatalogCourse>;
  try {
    catalog = await courseCatalog(accepted.directory);
  } catch (error) {
    throw new RankingsUnavailableError({ cause: error });
  }
  const linkRows = await queryRows(
    accepted.connection,
    `SELECT name, subject, code FROM read_parquet('${sqlPath(accepted.directory, "course-instructors.parquet")}') WHERE term_code = $termCode`,
    { termCode },
  );
  const identitiesByCourse = new Map<string, InstructorIdentity[]>();
  const coursesByInstructor = new Map<string, Set<string>>();
  for (const row of linkRows) {
    const courseKey = `${row.subject}${row.code}`;
    const identity = accepted.identitiesByName.get(String(row.name));
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
  const eligible: Candidate[] = [];
  for (const [key, values] of evidence) {
    if (weightedCriteria.some((criterion) => values[criterion] === undefined))
      continue;
    const score = weightedCriteria.reduce(
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
      eligible.push({
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
      const identity = accepted.identitiesByName.get(key);
      if (!identity) continue;
      const courseCodes = coursesByInstructor.get(key) ?? new Set();
      eligible.push({
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
  eligible.sort(
    (left, right) =>
      right.score - left.score || left.key.localeCompare(right.key),
  );
  const globalRanks = ranks(eligible);
  const filtered = eligible.filter((candidate) => {
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
  });
  const localRanks = ranks(filtered);
  const searched = search
    ? filtered.filter((candidate) => candidate.searchText.includes(search))
    : filtered;

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
  let start = 0;
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    if (cursor.g !== accepted.sha) throw new StaleRankingsCursorError();
    if (cursor.q !== fingerprint)
      throw new InvalidRankingsQueryError(
        "The cursor belongs to a different ranking query.",
      );
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
          q: fingerprint,
          p: page.at(-1)?.key,
        }),
      ).toString("base64url")
    : undefined;
  return {
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
  };
}

export async function getRankings(
  entity: { type: "instructor"; uuid: string },
  options: { activity?: "current" | "all" } = {},
): Promise<Rankings> {
  const accepted = await generation();
  const instructor = accepted.identitiesByUuid.get(entity.uuid.toLowerCase());
  if (entity.type !== "instructor" || !instructor)
    throw new TypeError("Unknown Instructor");
  const page = await queryRankings({
    entity: "instructor",
    activity: options.activity,
  });
  const ratings = await queryRows(
    accepted.connection,
    `SELECT term_code, criterion, bayesian, samples FROM read_parquet('${sqlPath(accepted.directory, "instructor-ratings.parquet")}') WHERE name = $name ORDER BY term_num, criterion`,
    { name: instructor.canonicalName },
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
    { name: instructor.canonicalName },
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
}

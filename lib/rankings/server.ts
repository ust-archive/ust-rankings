import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type DuckDBConnection,
  DuckDBInstance,
  type DuckDBValue,
} from "@duckdb/node-api";
import {
  INSTRUCTOR_UUID_PATTERN,
  ITSC_PATTERN,
  normalizeInstructorKey,
} from "@/lib/instructor-identity";
import {
  RANKING_CRITERIA as CRITERIA,
  type RankingCriterion as Criterion,
} from "@/lib/rankings/configuration";
import { rankingTermName } from "@/lib/rankings/presentation";
import { testGenerationDirectory } from "@/lib/test-generation";

const ARTIFACTS = [
  "course-instructors.parquet",
  "course-rankings.parquet",
  "course-ratings.parquet",
  "courses.parquet",
  "instructor-rankings.parquet",
  "instructor-ratings.parquet",
] as const;
const IDENTITY_ARTIFACTS = [
  "instructor-aliases.parquet",
  "instructor-identities.parquet",
  "instructor-identity-events.parquet",
  "instructor-split-affected-associations.parquet",
] as const;

export { rankingTermName } from "@/lib/rankings/presentation";

export type RankingPreset = "learning" | "grade";
export type RankingWeights = Partial<Record<Criterion, number>>;
export type CommonCoreScheme = "4Y" | "CC22" | "CC25" | "CC26";
export type CommonCoreCategory =
  | "ssc-humanities"
  | "ssc-social-analysis"
  | "ssc-science-technology"
  | "humanities"
  | "social-analysis"
  | "science-technology"
  | "quantitative-reasoning"
  | "arts"
  | "english-communication"
  | "chinese-communication"
  | "health"
  | "critical-thinking-data-literacy"
  | "healthy-lifestyle-mindfulness-well-being"
  | "science"
  | "technology"
  | "sustainability"
  | "haic"
  | "undergraduate-research"
  | "undergraduate-teaching"
  | "undergraduate-participation"
  | "undergraduate-community";

type CommonCoreCategoryDefinition = {
  value: CommonCoreCategory;
  label: string;
  attributeValue: string;
};

export type CommonCoreSchemeDefinition = {
  value: CommonCoreScheme;
  label: string;
  categories: ReadonlyArray<CommonCoreCategoryDefinition>;
};

const opportunities: ReadonlyArray<
  Omit<CommonCoreCategoryDefinition, "attributeValue">
> = [
  { value: "undergraduate-research", label: "UxOP-UROP" },
  { value: "undergraduate-teaching", label: "UxOP-UTOP" },
  { value: "undergraduate-participation", label: "UxOP-UPOP" },
  { value: "undergraduate-community", label: "UxOP-UCOP" },
];

export const COMMON_CORE_SCHEMES: ReadonlyArray<CommonCoreSchemeDefinition> = [
  {
    value: "4Y",
    label: "Students Admitted Before 2022",
    categories: [
      { value: "ssc-humanities", label: "SSC-H", attributeValue: "09" },
      {
        value: "ssc-social-analysis",
        label: "SSC-SA",
        attributeValue: "10",
      },
      {
        value: "ssc-science-technology",
        label: "SSC-S&T",
        attributeValue: "11",
      },
      { value: "humanities", label: "H", attributeValue: "12" },
      {
        value: "social-analysis",
        label: "SA",
        attributeValue: "13",
      },
      {
        value: "science-technology",
        label: "S&T",
        attributeValue: "14",
      },
      {
        value: "quantitative-reasoning",
        label: "QR",
        attributeValue: "15",
      },
      { value: "arts", label: "Arts", attributeValue: "16" },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "17",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "18",
      },
      { value: "health", label: "HLTH", attributeValue: "19" },
    ],
  },
  {
    value: "CC22",
    label: "Students Admitted in 2022–2024",
    categories: [
      {
        value: "critical-thinking-data-literacy",
        label: "CTDL",
        attributeValue: "20",
      },
      {
        value: "healthy-lifestyle-mindfulness-well-being",
        label: "HMW",
        attributeValue: "21",
      },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "22",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "23",
      },
      { value: "arts", label: "A", attributeValue: "24" },
      { value: "humanities", label: "H", attributeValue: "25" },
      { value: "science", label: "S", attributeValue: "26" },
      { value: "technology", label: "T", attributeValue: "27" },
      {
        value: "social-analysis",
        label: "SA",
        attributeValue: "28",
      },
      ...opportunities.map((category, index) => ({
        ...category,
        attributeValue: String(29 + index),
      })),
    ],
  },
  {
    value: "CC25",
    label: "Students Admitted in 2025",
    categories: [
      {
        value: "critical-thinking-data-literacy",
        label: "CTDL",
        attributeValue: "33",
      },
      {
        value: "healthy-lifestyle-mindfulness-well-being",
        label: "HMW",
        attributeValue: "34",
      },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "35",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "36",
      },
      { value: "arts", label: "A", attributeValue: "37" },
      { value: "humanities", label: "H", attributeValue: "38" },
      { value: "science", label: "S", attributeValue: "39" },
      { value: "technology", label: "T", attributeValue: "40" },
      {
        value: "social-analysis",
        label: "SA",
        attributeValue: "41",
      },
      {
        value: "sustainability",
        label: "SUS",
        attributeValue: "42",
      },
      ...opportunities.map((category, index) => ({
        ...category,
        attributeValue: String(43 + index),
      })),
    ],
  },
  {
    value: "CC26",
    label: "Students Admitted From 2026",
    categories: [
      { value: "haic", label: "HAIC", attributeValue: "47" },
      {
        value: "healthy-lifestyle-mindfulness-well-being",
        label: "HMW",
        attributeValue: "48",
      },
      {
        value: "english-communication",
        label: "E-Comm",
        attributeValue: "49",
      },
      {
        value: "chinese-communication",
        label: "C-Comm",
        attributeValue: "50",
      },
      { value: "arts", label: "A", attributeValue: "51" },
      { value: "humanities", label: "H", attributeValue: "52" },
      { value: "science", label: "S", attributeValue: "53" },
      { value: "technology", label: "T", attributeValue: "54" },
      {
        value: "social-analysis",
        label: "SA",
        attributeValue: "55",
      },
      {
        value: "sustainability",
        label: "SUS",
        attributeValue: "56",
      },
      ...opportunities.map((category, index) => ({
        ...category,
        attributeValue: String(57 + index),
      })),
    ],
  },
];

const commonCoreSchemes = new Map(
  COMMON_CORE_SCHEMES.map((scheme) => [scheme.value, scheme]),
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
  "courses.parquet": [
    ["prefix", "VARCHAR"],
    ["number", "VARCHAR"],
    ["title", "VARCHAR"],
    [
      "attributes",
      'STRUCT("label" VARCHAR, "value" VARCHAR, description VARCHAR)[]',
    ],
  ],
  "course-instructors.parquet": [
    ["uuid", "VARCHAR"],
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
    ["uuid", "VARCHAR"],
    ["name", "VARCHAR"],
    ["term_num", "INTEGER"],
    ["term_code", "VARCHAR"],
    ["is_teaching", "BOOLEAN"],
    ...ratingColumns.slice(2),
  ],
  "instructor-ratings.parquet": [
    ["uuid", "VARCHAR"],
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

type AffectedInstructorAssociation = {
  sourceCommit: string;
  sourceName: string;
  termCode?: string;
  courseCode?: string;
};

export type InstructorIdentityEvent =
  | {
      type: "itsc-added";
      uuid: string;
      itsc: string;
      sourceCommit: string;
    }
  | {
      type: "merge";
      retiredUuid: string;
      survivorUuid: string;
      sourceCommit: string;
    }
  | {
      type: "split";
      sourceUuid: string;
      newUuid: string;
      newIdentity: InstructorIdentity;
      sourceCommit: string;
      affectedAssociations: AffectedInstructorAssociation[];
    };

type InstructorIdentifierHistory = {
  type: "itsc";
  value: string;
  status: "current" | "retired";
  sourceCommit: string;
};

type Manifest = {
  schemaMajor: number;
  sourceCommit: string;
  artifacts: Record<string, { sha256: string; size: number }>;
  identities: InstructorIdentity[];
  identityEvents?: InstructorIdentityEvent[];
};

type Generation = {
  sha: string;
  courseDigest: string;
  directory: string;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  identitiesByCurrentName: Map<string, InstructorIdentity[]>;
  identitiesByObservedName: Map<string, InstructorIdentity[]>;
  identitiesByUuid: Map<string, InstructorIdentity>;
  identitiesByItsc: Map<string, InstructorIdentity>;
  currentNameByUuid: Map<string, string>;
  redirectByUuid: Map<string, string>;
  identifiersByUuid: Map<string, InstructorIdentifierHistory[]>;
  identityEvents: InstructorIdentityEvent[];
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
  commonCoreScheme?: CommonCoreScheme;
  commonCore?: CommonCoreCategory[];
  course?: string;
  limit?: number;
  cursor?: string;
};

type RankFields = {
  score: number;
  rank?: number;
  rankPopulation: number;
  percentile?: number;
  allTimeRank: number;
  allTimePopulation: number;
  allTimePercentile: number;
  ustSpaceSamples: number;
  sfqSamples: number;
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

export type ScoreDistribution = {
  bins: number[];
  count: number;
  maximum: number;
  minimum: number;
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
  terms: Array<{ termCode: string; termName: string }>;
  results: [Entity] extends ["course"]
    ? CourseRanking[]
    : [Entity] extends ["instructor"]
      ? InstructorRanking[]
      : Array<CourseRanking | InstructorRanking>;
  nextCursor?: string;
  unrankedMatchCount: number;
};

type RankingTermEvidence = {
  termCode: string;
  criteria: Partial<
    Record<
      Criterion,
      {
        bayesian: number;
        confidence: number;
        samples: number;
        cumulativeSamples: number;
      }
    >
  >;
};

export type InstructorIdentityLookup = {
  generation: string;
  instructor: InstructorIdentity;
  family: InstructorIdentity[];
  familyUuids: string[];
  route: { canonicalKey: string; redirect: boolean };
  identityHistory: {
    identifiers: InstructorIdentifierHistory[];
    events: InstructorIdentityEvent[];
    affectedAssociations: Array<
      AffectedInstructorAssociation & { status: "needs-resolution" }
    >;
  };
};

export type InstructorHistoricalEvidence = {
  instructor: InstructorIdentity;
  terms: RankingTermEvidence[];
  courses: Array<{ termCode: string; courseCode: string }>;
};

export type Rankings = InstructorIdentityLookup & {
  population: RankingsPage["population"];
  configuration: RankingsPage["configuration"];
  scoreDistribution: ScoreDistribution;
  ranking?: InstructorRanking;
  terms: RankingTermEvidence[];
  courses: Array<{ termCode: string; courseCode: string }>;
  historicalEvidence: InstructorHistoricalEvidence[];
};

export type CourseRankings = {
  generation: string;
  population: RankingsPage<"course">["population"];
  configuration: RankingsPage<"course">["configuration"];
  scoreDistribution: ScoreDistribution;
  course: Pick<
    CourseRanking,
    "coursePrefix" | "courseNumber" | "courseCode" | "title" | "commonCore"
  >;
  ranking?: CourseRanking;
  terms: RankingTermEvidence[];
  instructors: Array<{
    termCode: string;
    instructor: InstructorIdentity;
  }>;
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

export class UnknownRankingsEntityError extends TypeError {
  constructor(entity: "Course" | "Instructor") {
    super(`Unknown ${entity}`);
    this.name = "UnknownRankingsEntityError";
  }
}

export class StaleRankingsCursorError extends InvalidRankingsQueryError {
  constructor() {
    super("The ranking snapshot changed; restart pagination.");
    this.name = "StaleRankingsCursorError";
  }
}

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
  | { directory: string; loading?: Promise<Generation> }
  | undefined;
let openGenerationCount = 0;

function configureBrowserTestGeneration() {
  const directory = testGenerationDirectory("TEST_RANKING_GENERATION");
  if (directory && explicitGeneration?.directory !== directory)
    explicitGeneration = { directory };
}
let afterAcquireForTests: ((generation: string) => Promise<void>) | undefined;

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
  if (ARTIFACTS.some((name) => !parquetFiles.includes(name)))
    throw new Error("Unexpected ranking artifacts");
  if (IDENTITY_ARTIFACTS.some((name) => !parquetFiles.includes(name)))
    throw new Error(
      "Ranking generation is missing Instructor identity Parquet",
    );
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

  const courseDimension = sqlPath(directory, "courses.parquet");
  const courses = sqlPath(directory, "course-ratings.parquet");
  const courseRanks = sqlPath(directory, "course-rankings.parquet");
  const instructors = sqlPath(directory, "instructor-ratings.parquet");
  const instructorRanks = sqlPath(directory, "instructor-rankings.parquet");
  const links = sqlPath(directory, "course-instructors.parquet");
  const checks = [
    `SELECT prefix, number FROM read_parquet('${courseDimension}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT 1 FROM read_parquet('${courseDimension}') WHERE prefix IS NULL OR NOT regexp_full_match(prefix, '[A-Z]{2,8}') OR number IS NULL OR NOT regexp_full_match(number, '[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?') OR title IS NULL OR trim(title) = '' OR attributes IS NULL OR list_has_any(list_transform(attributes, attribute -> attribute.label IS NULL OR trim(attribute.label) = '' OR attribute.value IS NULL OR trim(attribute.value) = ''), [true])`,
    `SELECT subject, code, term_num, criterion FROM read_parquet('${courses}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT subject, code, term_num, criterion FROM read_parquet('${courseRanks}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT uuid, term_num, criterion FROM read_parquet('${instructors}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT uuid, term_num, criterion FROM read_parquet('${instructorRanks}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT uuid, term_num, subject, code FROM read_parquet('${links}') GROUP BY ALL HAVING count(*) > 1`,
    `SELECT term_num FROM read_parquet(['${courses}', '${courseRanks}', '${instructors}', '${instructorRanks}', '${links}'], union_by_name=true) GROUP BY term_num HAVING count(DISTINCT term_code) <> 1`,
    `SELECT term_code FROM read_parquet(['${courses}', '${courseRanks}', '${instructors}', '${instructorRanks}', '${links}'], union_by_name=true) GROUP BY term_code HAVING count(DISTINCT term_num) <> 1`,
    `SELECT 1 FROM read_parquet('${courseRanks}') rankings LEFT JOIN read_parquet('${courses}') ratings USING (subject, code, term_num, term_code, criterion) WHERE ratings.subject IS NULL`,
    `SELECT 1 FROM read_parquet('${instructorRanks}') rankings LEFT JOIN read_parquet('${instructors}') ratings USING (uuid, term_num, term_code, criterion) WHERE ratings.uuid IS NULL`,
    `SELECT 1 FROM read_parquet(['${courses}', '${courseRanks}'], union_by_name=true) WHERE subject IS NULL OR code IS NULL OR term_num IS NULL OR term_code IS NULL OR is_offered IS NULL`,
    `SELECT 1 FROM read_parquet(['${instructors}', '${instructorRanks}'], union_by_name=true) WHERE uuid IS NULL OR NOT regexp_full_match(uuid, '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}') OR name IS NULL OR term_num IS NULL OR term_code IS NULL OR is_teaching IS NULL`,
    `SELECT 1 FROM read_parquet('${links}') WHERE uuid IS NULL OR NOT regexp_full_match(uuid, '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}') OR name IS NULL OR term_num IS NULL OR term_code IS NULL OR subject IS NULL OR code IS NULL`,
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
    `SELECT links.uuid FROM read_parquet('${links}') links JOIN read_parquet('${instructorRanks}') rankings USING (uuid, term_num) LIMIT 1`,
  ];
  for (const smokeQuery of smokeQueries) {
    if ((await queryRows(connection, smokeQuery)).length !== 1)
      throw new Error("Representative ranking query failed");
  }
}

function normalizedInstructorName(name: string) {
  return name.trim().toLocaleLowerCase();
}

type InstructorCourseOfferingEvidence = {
  uuid: string;
  termCode: string;
  coursePrefix: string;
  courseNumber: string;
};

async function instructorCourseOfferingEvidence(
  connection: DuckDBConnection,
  directory: string,
) {
  return (
    await queryRows(
      connection,
      `SELECT DISTINCT uuid, term_code, subject, code FROM read_parquet('${sqlPath(directory, "course-instructors.parquet")}') ORDER BY uuid, term_code, subject, code`,
    )
  ).map((row) => ({
    uuid: String(row.uuid),
    termCode: String(row.term_code),
    coursePrefix: String(row.subject),
    courseNumber: String(row.code),
  }));
}

type InstructorRegistry = Pick<
  Generation,
  | "sha"
  | "identitiesByUuid"
  | "identitiesByItsc"
  | "identitiesByObservedName"
  | "redirectByUuid"
  | "identifiersByUuid"
  | "identityEvents"
>;

function resolvedInstructorIdentity(
  generation: InstructorRegistry,
  identity: InstructorIdentity,
) {
  let uuid = identity.uuid;
  while (generation.redirectByUuid.has(uuid))
    uuid = generation.redirectByUuid.get(uuid) as string;
  return generation.identitiesByUuid.get(uuid) as InstructorIdentity;
}

function validateIdentities(
  manifest: Manifest,
  rankingIdentities: Array<{ uuid: string; name: string }>,
  courseOfferings: InstructorCourseOfferingEvidence[],
) {
  const uuidPattern = INSTRUCTOR_UUID_PATTERN;
  const itscPattern = ITSC_PATTERN;
  const observedNames = new Map<string, InstructorIdentity[]>();
  const currentNames = new Map<string, InstructorIdentity[]>();
  const canonicalNames = new Map<string, InstructorIdentity[]>();
  const identitiesByUuid = new Map<string, InstructorIdentity>();
  const identitiesByItsc = new Map<string, InstructorIdentity>();
  const identifiersByUuid = new Map<string, InstructorIdentifierHistory[]>();
  const redirectByUuid = new Map<string, string>();
  const claimedItscs = new Map<string, string>();

  for (const identity of manifest.identities) {
    const canonicalName = identity.canonicalName?.trim().toLocaleLowerCase();
    const itsc = identity.itsc?.trim().toLocaleLowerCase();
    if (
      !uuidPattern.test(identity.uuid) ||
      identitiesByUuid.has(identity.uuid) ||
      !canonicalName ||
      canonicalName === "tba" ||
      (identity.itsc !== undefined && (!itsc || !itscPattern.test(itsc)))
    )
      throw new Error("Invalid Instructor identity");
    identitiesByUuid.set(identity.uuid, identity);
    const canonicalOwners = canonicalNames.get(canonicalName) ?? [];
    canonicalOwners.push(identity);
    canonicalNames.set(canonicalName, canonicalOwners);
    if (itsc) {
      if (claimedItscs.has(itsc)) throw new Error("ITSC history is not unique");
      identity.itsc = itsc;
      claimedItscs.set(itsc, identity.uuid);
      identifiersByUuid.set(identity.uuid, [
        {
          type: "itsc",
          value: itsc,
          status: "current",
          sourceCommit: manifest.sourceCommit,
        },
      ]);
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
    )
      throw new Error("Instructor aliases require source provenance");

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
    for (const observedName of [
      identity.canonicalName,
      ...identity.aliases
        .filter(
          (alias) =>
            alias.source === "ranking-generation" &&
            alias.sourceCommit === manifest.sourceCommit,
        )
        .map((alias) => alias.name),
    ]) {
      const normalized = normalizedInstructorName(observedName);
      const owners = currentNames.get(normalized) ?? [];
      if (!owners.some((owner) => owner.uuid === identity.uuid))
        owners.push(identity);
      currentNames.set(normalized, owners);
    }
  }

  const identityEvents = manifest.identityEvents ?? [];
  if (!Array.isArray(identityEvents))
    throw new Error("Invalid Instructor identity event history");
  const eventKeys = new Set<string>();
  const splitTargets = new Set<string>();
  const addedItscs = new Set<string>();
  for (const event of identityEvents) {
    const eventKey = JSON.stringify(event);
    if (eventKeys.has(eventKey) || !/^[0-9a-f]{40}$/.test(event.sourceCommit))
      throw new Error("Invalid Instructor identity event history");
    eventKeys.add(eventKey);
    if (event.type === "itsc-added") {
      const identity = identitiesByUuid.get(event.uuid);
      const itsc = event.itsc?.trim().toLocaleLowerCase();
      const claimedBy = claimedItscs.get(itsc);
      if (
        !identity ||
        !itscPattern.test(itsc) ||
        (claimedBy !== undefined && claimedBy !== event.uuid) ||
        addedItscs.has(itsc)
      )
        throw new Error("Invalid ITSC addition");
      addedItscs.add(itsc);
      const identifiers = identifiersByUuid.get(event.uuid) ?? [];
      for (const identifier of identifiers) identifier.status = "retired";
      const projected = identifiers.find(
        (identifier) => identifier.value === itsc,
      );
      if (projected) {
        projected.status = "current";
        projected.sourceCommit = event.sourceCommit;
      } else
        identifiers.push({
          type: "itsc",
          value: itsc,
          status: "current",
          sourceCommit: event.sourceCommit,
        });
      identifiersByUuid.set(event.uuid, identifiers);
      claimedItscs.set(itsc, event.uuid);
      identity.itsc = itsc;
    } else if (event.type === "merge") {
      if (
        event.retiredUuid === event.survivorUuid ||
        !identitiesByUuid.has(event.retiredUuid) ||
        !identitiesByUuid.has(event.survivorUuid) ||
        redirectByUuid.has(event.retiredUuid)
      )
        throw new Error("Invalid Instructor merge");
      redirectByUuid.set(event.retiredUuid, event.survivorUuid);
    } else if (event.type === "split") {
      if (
        event.sourceUuid === event.newUuid ||
        !identitiesByUuid.has(event.sourceUuid) ||
        !identitiesByUuid.has(event.newUuid) ||
        event.newIdentity?.uuid !== event.newUuid ||
        identitiesByUuid.get(event.newUuid)?.canonicalName !==
          event.newIdentity.canonicalName ||
        JSON.stringify(
          identitiesByUuid
            .get(event.newUuid)
            ?.aliases.slice(0, event.newIdentity.aliases.length),
        ) !== JSON.stringify(event.newIdentity.aliases) ||
        event.newIdentity.aliases.length === 0 ||
        event.newIdentity.aliases.some(
          (alias) => alias.sourceCommit !== event.sourceCommit,
        ) ||
        splitTargets.has(event.newUuid) ||
        !Array.isArray(event.affectedAssociations) ||
        event.affectedAssociations.length === 0 ||
        event.affectedAssociations.some(
          (association) =>
            !association.sourceName?.trim() ||
            !/^[0-9a-f]{40}$/.test(association.sourceCommit) ||
            (association.termCode !== undefined &&
              !/^[0-9]{4}$/.test(association.termCode)) ||
            (association.courseCode !== undefined &&
              !/^[A-Z]{2,8} [0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(
                association.courseCode,
              )),
        )
      )
        throw new Error("Invalid Instructor split");
      splitTargets.add(event.newUuid);
    } else {
      throw new Error("Unknown Instructor identity event");
    }
  }

  const offeringKeysByUuid = new Map<string, Set<string>>();
  for (const offering of courseOfferings) {
    if (!identitiesByUuid.has(offering.uuid))
      throw new Error("Instructor association has an unknown UUID");
    const keys = offeringKeysByUuid.get(offering.uuid) ?? new Set<string>();
    keys.add(
      `${offering.termCode}\0${offering.coursePrefix}\0${offering.courseNumber}`,
    );
    offeringKeysByUuid.set(offering.uuid, keys);
  }
  for (const owners of canonicalNames.values()) {
    if (owners.length < 2) continue;
    const uuids = new Set(owners.map((identity) => identity.uuid));
    const distinguished = new Set<string>();
    for (const event of identityEvents) {
      if (
        event.type === "split" &&
        uuids.has(event.sourceUuid) &&
        uuids.has(event.newUuid)
      ) {
        distinguished.add(event.sourceUuid);
        distinguished.add(event.newUuid);
      } else if (
        event.type === "merge" &&
        uuids.has(event.retiredUuid) &&
        uuids.has(event.survivorUuid)
      ) {
        distinguished.add(event.retiredUuid);
        distinguished.add(event.survivorUuid);
      }
    }
    const fingerprintByUuid = new Map(
      owners.map((identity) => [
        identity.uuid,
        [...(offeringKeysByUuid.get(identity.uuid) ?? [])].sort().join("\n"),
      ]),
    );
    const offeringFingerprintCounts = new Map<string, number>();
    for (const fingerprint of fingerprintByUuid.values())
      if (fingerprint)
        offeringFingerprintCounts.set(
          fingerprint,
          (offeringFingerprintCounts.get(fingerprint) ?? 0) + 1,
        );
    for (const identity of owners) {
      const hasUniqueName = [
        identity.canonicalName,
        ...identity.aliases.map((alias) => alias.name),
      ].some(
        (name) =>
          observedNames.get(normalizedInstructorName(name))?.length === 1,
      );
      const fingerprint = fingerprintByUuid.get(identity.uuid);
      if (
        hasUniqueName ||
        (fingerprint && offeringFingerprintCounts.get(fingerprint) === 1)
      )
        distinguished.add(identity.uuid);
    }
    if (distinguished.size < owners.length - 1)
      throw new Error("Same-name Instructors lack distinguishing history");
  }

  const finalUuid = (uuid: string) => {
    const visited = new Set<string>();
    let current = uuid;
    while (redirectByUuid.has(current)) {
      if (visited.has(current)) throw new Error("Cyclic Instructor merge");
      visited.add(current);
      current = redirectByUuid.get(current) as string;
    }
    return current;
  };
  for (const uuid of identitiesByUuid.keys()) finalUuid(uuid);
  for (const [itsc, uuid] of claimedItscs) {
    const identity = identitiesByUuid.get(uuid);
    if (!identity) throw new Error("Unknown ITSC owner");
    identitiesByItsc.set(itsc, identity);
  }
  for (const [uuid, identifiers] of identifiersByUuid) {
    const final = finalUuid(uuid);
    const preferred = identitiesByUuid.get(final)?.itsc;
    for (const identifier of identifiers)
      identifier.status =
        uuid === final && identifier.value === preferred
          ? "current"
          : "retired";
  }

  const currentNameByUuid = new Map<string, string>();
  for (const { uuid, name } of rankingIdentities) {
    const identity = identitiesByUuid.get(uuid);
    if (
      !identity ||
      !currentNames
        .get(normalizedInstructorName(name))
        ?.some((candidate) => candidate.uuid === uuid)
    )
      throw new Error("Instructor registry does not match the generation");
    const existing = currentNameByUuid.get(uuid);
    if (existing && existing !== name)
      throw new Error("Instructor UUID has several current ranking names");
    currentNameByUuid.set(uuid, name);
  }
  return {
    currentNames,
    observedNames,
    identitiesByUuid,
    identitiesByItsc,
    currentNameByUuid,
    redirectByUuid,
    identifiersByUuid,
    identityEvents,
  };
}

function lookupInstructorIdentity(
  registry: InstructorRegistry,
  requestedKey: string,
): InstructorIdentityLookup {
  const normalizedKey = normalizeInstructorKey(requestedKey);
  const requestedIdentity = normalizedKey
    ? (registry.identitiesByUuid.get(normalizedKey) ??
      registry.identitiesByItsc.get(normalizedKey))
    : undefined;
  if (!requestedIdentity) throw new UnknownRankingsEntityError("Instructor");
  const instructor = resolvedInstructorIdentity(registry, requestedIdentity);
  const family = [...registry.identitiesByUuid.values()].filter(
    (identity) =>
      resolvedInstructorIdentity(registry, identity).uuid === instructor.uuid,
  );
  const familyUuids = family.map((identity) => identity.uuid);
  const familySet = new Set(familyUuids);
  const events = registry.identityEvents.filter((event) => {
    if (event.type === "itsc-added") return familySet.has(event.uuid);
    if (event.type === "merge")
      return (
        familySet.has(event.retiredUuid) || familySet.has(event.survivorUuid)
      );
    return familySet.has(event.sourceUuid) || familySet.has(event.newUuid);
  });
  const canonicalKey = instructor.itsc ?? instructor.uuid;
  return {
    generation: registry.sha,
    instructor,
    family,
    familyUuids,
    route: {
      canonicalKey,
      redirect: requestedKey !== canonicalKey,
    },
    identityHistory: {
      identifiers: familyUuids.flatMap(
        (uuid) => registry.identifiersByUuid.get(uuid) ?? [],
      ),
      events,
      affectedAssociations: events.flatMap((event) =>
        event.type === "split"
          ? event.affectedAssociations.map((association) => ({
              ...association,
              status: "needs-resolution" as const,
            }))
          : [],
      ),
    },
  };
}

function associationNeedsResolution(
  registry: InstructorRegistry,
  association: {
    uuid?: string;
    sourceName: string;
    termCode: string;
    courseCode: string;
  },
) {
  return registry.identityEvents.some(
    (event) =>
      event.type === "split" &&
      association.uuid !== event.newUuid &&
      event.affectedAssociations.some(
        (affected) =>
          normalizedInstructorName(affected.sourceName) ===
            normalizedInstructorName(association.sourceName) &&
          (affected.termCode === undefined ||
            affected.termCode === association.termCode) &&
          (affected.courseCode === undefined ||
            affected.courseCode === association.courseCode),
      ),
  );
}

function resolveInstructorAssociation(
  registry: Generation,
  association: {
    uuid: string;
    sourceName: string;
    termCode: string;
    courseCode: string;
  },
) {
  if (associationNeedsResolution(registry, association)) return undefined;
  const identity = registry.identitiesByUuid.get(association.uuid);
  return identity ? resolvedInstructorIdentity(registry, identity) : undefined;
}

async function applyIdentityParquet(
  connection: DuckDBConnection,
  directory: string,
  manifest: Manifest,
) {
  try {
    await stat(resolve(directory, "instructor-identities.parquet"));
  } catch {
    throw new Error(
      "Ranking generation is missing Instructor identity Parquet",
    );
  }
  const extraIdentities = [...manifest.identities];
  const extraEvents = [...(manifest.identityEvents ?? [])];
  const identityRows = await queryRows(
    connection,
    `SELECT uuid, canonical_name, itsc FROM read_parquet('${sqlPath(directory, "instructor-identities.parquet")}')`,
  );
  const aliasRows = await queryRows(
    connection,
    `SELECT uuid, name, source, source_commit, source_file FROM read_parquet('${sqlPath(directory, "instructor-aliases.parquet")}')`,
  );
  const eventRows = await queryRows(
    connection,
    `SELECT event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid FROM read_parquet('${sqlPath(directory, "instructor-identity-events.parquet")}')`,
  );
  const aliasesByUuid = new Map<string, InstructorIdentity["aliases"]>();
  for (const row of aliasRows) {
    const uuid = String(row.uuid);
    const aliases = aliasesByUuid.get(uuid) ?? [];
    aliases.push({
      name: String(row.name),
      source: String(
        row.source,
      ) as InstructorIdentity["aliases"][number]["source"],
      sourceCommit: String(row.source_commit),
      sourceFile:
        row.source_file === null || row.source_file === undefined
          ? undefined
          : (String(row.source_file) as "instructor-ratings.parquet"),
    });
    aliasesByUuid.set(uuid, aliases);
  }
  manifest.identities = identityRows.map((row) => ({
    uuid: String(row.uuid),
    canonicalName: String(row.canonical_name),
    itsc:
      row.itsc === null || row.itsc === undefined
        ? undefined
        : String(row.itsc),
    aliases: aliasesByUuid.get(String(row.uuid)) ?? [],
  }));
  const affectedRows = await queryRows(
    connection,
    `SELECT source_commit, new_uuid, source_name, term_code, course_code FROM read_parquet('${sqlPath(directory, "instructor-split-affected-associations.parquet")}')`,
  );
  const affectedByNewUuid = new Map<string, AffectedInstructorAssociation[]>();
  for (const row of affectedRows) {
    const newUuid = String(row.new_uuid);
    const affected = affectedByNewUuid.get(newUuid) ?? [];
    affected.push({
      sourceCommit: String(row.source_commit),
      sourceName: String(row.source_name),
      termCode:
        row.term_code === null || row.term_code === undefined
          ? undefined
          : String(row.term_code),
      courseCode:
        row.course_code === null || row.course_code === undefined
          ? undefined
          : String(row.course_code),
    });
    affectedByNewUuid.set(newUuid, affected);
  }
  const identitiesByUuid = new Map(
    manifest.identities.map((identity) => [identity.uuid, identity]),
  );
  const identityEvents: InstructorIdentityEvent[] = eventRows.flatMap(
    (row): InstructorIdentityEvent[] => {
      const type = String(row.event_type);
      const sourceCommit = String(row.source_commit);
      if (type === "itsc-added")
        return [
          {
            type: "itsc-added" as const,
            uuid: String(row.uuid),
            itsc: String(row.itsc),
            sourceCommit,
          },
        ];
      if (type === "merge")
        return [
          {
            type: "merge" as const,
            retiredUuid: String(row.retired_uuid),
            survivorUuid: String(row.survivor_uuid),
            sourceCommit,
          },
        ];
      if (type === "split") {
        const newIdentity = identitiesByUuid.get(String(row.new_uuid));
        if (!newIdentity) return [];
        return [
          {
            type: "split" as const,
            sourceUuid: String(row.source_uuid),
            newUuid: String(row.new_uuid),
            newIdentity,
            sourceCommit,
            affectedAssociations:
              affectedByNewUuid.get(String(row.new_uuid)) ?? [],
          },
        ];
      }
      return [];
    },
  );
  const known = new Set(manifest.identities.map((identity) => identity.uuid));
  for (const identity of extraIdentities)
    if (!known.has(identity.uuid)) {
      manifest.identities.push(identity);
      known.add(identity.uuid);
    }
  manifest.identityEvents = [...identityEvents, ...extraEvents];
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
      await applyIdentityParquet(connection, directory, manifest);
      const identityRows = await queryRows(
        connection,
        `SELECT DISTINCT uuid, name FROM read_parquet('${sqlPath(directory, "instructor-ratings.parquet")}') ORDER BY uuid`,
      );
      const identityNames = validateIdentities(
        manifest,
        identityRows.map((row) => ({
          uuid: String(row.uuid),
          name: String(row.name),
        })),
        await instructorCourseOfferingEvidence(connection, directory),
      );
      openGenerationCount += 1;
      return {
        sha: manifest.sourceCommit,
        courseDigest: manifest.artifacts["courses.parquet"].sha256,
        directory,
        instance,
        connection,
        identitiesByCurrentName: identityNames.currentNames,
        identitiesByObservedName: identityNames.observedNames,
        identitiesByUuid: identityNames.identitiesByUuid,
        identitiesByItsc: identityNames.identitiesByItsc,
        currentNameByUuid: identityNames.currentNameByUuid,
        redirectByUuid: identityNames.redirectByUuid,
        identifiersByUuid: identityNames.identifiersByUuid,
        identityEvents: identityNames.identityEvents,
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

async function loadInstructorRegistry(
  directory: string,
): Promise<InstructorRegistry> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "manifest.json"), "utf8"),
    ) as Manifest;
    if (
      manifest.schemaMajor !== 0 ||
      !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
      basename(resolve(directory)) !== manifest.sourceCommit
    )
      throw new Error("Invalid Instructor registry manifest");
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    let identities: ReturnType<typeof validateIdentities>;
    try {
      await applyIdentityParquet(connection, directory, manifest);
      identities = validateIdentities(
        manifest,
        [],
        await instructorCourseOfferingEvidence(connection, directory),
      );
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
    return {
      sha: manifest.sourceCommit,
      identitiesByUuid: identities.identitiesByUuid,
      identitiesByItsc: identities.identitiesByItsc,
      identitiesByObservedName: identities.observedNames,
      redirectByUuid: identities.redirectByUuid,
      identifiersByUuid: identities.identifiersByUuid,
      identityEvents: identities.identityEvents,
    };
  } catch (error) {
    throw new RankingsUnavailableError({ cause: error });
  }
}

async function instructorRegistry(): Promise<InstructorRegistry> {
  configureBrowserTestGeneration();
  if (runtimeActive) {
    const accepted = await runtimeActive.catch(() => undefined);
    if (accepted && !accepted.closed) return accepted;
  }
  if (explicitGeneration)
    return loadInstructorRegistry(explicitGeneration.directory);
  try {
    runtimeDependencies ??= (
      await import("./runtime")
    ).productionRankingRefreshDependencies();
    const pointer = await runtimeDependencies.store.readPointer();
    if (pointer)
      for (const sha of [pointer.activeSha, pointer.previousSha]) {
        if (!sha) continue;
        const directory = await runtimeDependencies.store
          .downloadGeneration(sha)
          .catch(() => undefined);
        if (!directory) continue;
        try {
          return await loadInstructorRegistry(directory);
        } catch {
          // Try the retained previous registry.
        }
      }
  } catch {
    // Rankings stay unavailable until a Hugging Face generation is accepted.
  }
  throw new RankingsUnavailableError();
}

export async function getInstructorIdentity(key: string) {
  return lookupInstructorIdentity(await instructorRegistry(), key.trim());
}

export async function instructorNamesForUuids(uuids: string[]) {
  const names = new Map<string, string>();
  if (uuids.length === 0) return names;
  let registry: InstructorRegistry;
  try {
    registry = await instructorRegistry();
  } catch {
    return names;
  }
  for (const uuid of new Set(uuids.map((value) => value.toLowerCase())))
    try {
      names.set(
        uuid,
        lookupInstructorIdentity(registry, uuid).instructor.canonicalName,
      );
    } catch {
      // Contributions remain available when an Instructor cannot be resolved.
    }
  return names;
}

function rankingGenerationIsReady() {
  configureBrowserTestGeneration();
  return Boolean(runtimeActive || explicitGeneration);
}

export async function resolveObservedInstructorNames(names: string[]) {
  const resolved = new Map<string, string>();
  const unique = [
    ...new Set(
      names.map((name) => name.trim()).filter((name) => name.length > 0),
    ),
  ];
  if (unique.length === 0 || !rankingGenerationIsReady()) return resolved;
  try {
    const registry = await instructorRegistry();
    for (const name of unique) {
      if (name.toLocaleLowerCase() === "tba") continue;
      const observed = registry.identitiesByObservedName.get(
        normalizedInstructorName(name),
      );
      if (observed?.length !== 1) continue;
      resolved.set(
        name,
        resolvedInstructorIdentity(registry, observed[0]).uuid,
      );
    }
  } catch {
    // Rankings unavailable: Schedule names stay unresolved.
  }
  return resolved;
}

function observedInstructorCandidateUuids(
  registry: InstructorRegistry,
  sourceName: string,
) {
  return new Set(
    (
      registry.identitiesByObservedName.get(
        normalizedInstructorName(sourceName),
      ) ?? []
    ).map((identity) => resolvedInstructorIdentity(registry, identity).uuid),
  );
}

export type ObservedInstructorCourseOffering = {
  sourceName: string;
  termCode: string;
  coursePrefix: string;
  courseNumber: string;
};

export async function resolveObservedInstructorCourseOfferings(
  associations: ObservedInstructorCourseOffering[],
) {
  if (associations.length === 0) return [];
  const registry = await instructorRegistry();
  const resolved = associations.map((association) => {
    const candidates = observedInstructorCandidateUuids(
      registry,
      association.sourceName,
    );
    return candidates.size === 1 ? [...candidates][0] : undefined;
  });
  const ambiguous = associations.flatMap((association, index) =>
    resolved[index] ? [] : [{ association, index }],
  );
  if (ambiguous.length === 0) return resolved;

  const lease = await acquireGeneration();
  try {
    const parameters = Object.fromEntries(
      ambiguous.flatMap(({ association, index }) => [
        [`term${index}`, association.termCode],
        [`prefix${index}`, association.coursePrefix],
        [`number${index}`, association.courseNumber],
      ]),
    );
    const where = ambiguous
      .map(
        ({ index }) =>
          `(term_code = $term${index} AND subject = $prefix${index} AND code = $number${index})`,
      )
      .join(" OR ");
    const rows = await queryRows(
      lease.accepted.connection,
      `SELECT uuid, term_code, subject, code FROM read_parquet('${sqlPath(lease.accepted.directory, "course-instructors.parquet")}') WHERE ${where}`,
      parameters,
    );
    for (const { association, index } of ambiguous) {
      const candidates = observedInstructorCandidateUuids(
        lease.accepted,
        association.sourceName,
      );
      const matches = new Set(
        rows.flatMap((row) =>
          String(row.term_code) === association.termCode &&
          String(row.subject) === association.coursePrefix &&
          String(row.code) === association.courseNumber &&
          candidates.has(String(row.uuid))
            ? [String(row.uuid)]
            : [],
        ),
      );
      if (matches.size === 1) resolved[index] = [...matches][0];
    }
    return resolved;
  } finally {
    await lease.release();
  }
}

export async function courseOfferingsForInstructorUuids(uuids: string[]) {
  const unique = [...new Set(uuids.map((uuid) => uuid.toLowerCase()))];
  if (unique.length === 0) return [];
  const lease = await acquireGeneration();
  try {
    const wanted = new Set(
      unique.flatMap((uuid) => {
        const identity = lease.accepted.identitiesByUuid.get(uuid);
        return identity
          ? [resolvedInstructorIdentity(lease.accepted, identity).uuid]
          : [];
      }),
    );
    const mergeFamilyUuids = [
      ...lease.accepted.identitiesByUuid.values(),
    ].flatMap((identity) =>
      wanted.has(resolvedInstructorIdentity(lease.accepted, identity).uuid)
        ? [identity.uuid]
        : [],
    );
    if (mergeFamilyUuids.length === 0) return [];
    const parameters = Object.fromEntries(
      mergeFamilyUuids.map((uuid, index) => [`uuid${index}`, uuid]),
    );
    const placeholders = mergeFamilyUuids
      .map((_, index) => `$uuid${index}`)
      .join(", ");
    const rows = await queryRows(
      lease.accepted.connection,
      `SELECT DISTINCT uuid, term_code, subject, code FROM read_parquet('${sqlPath(lease.accepted.directory, "course-instructors.parquet")}') WHERE uuid IN (${placeholders})`,
      parameters,
    );
    return rows.map((row) => ({
      uuid: String(row.uuid),
      termCode: String(row.term_code),
      coursePrefix: String(row.subject),
      courseNumber: String(row.code),
    }));
  } finally {
    await lease.release();
  }
}

export async function observedNamesForInstructorUuids(uuids: string[]) {
  const wanted = new Set(uuids);
  if (wanted.size === 0 || !rankingGenerationIsReady()) return [];
  try {
    const registry = await instructorRegistry();
    const names: string[] = [];
    for (const identity of registry.identitiesByUuid.values()) {
      const resolved = resolvedInstructorIdentity(registry, identity);
      if (!wanted.has(resolved.uuid)) continue;
      for (const name of [
        identity.canonicalName,
        ...identity.aliases.map((alias) => alias.name),
      ]) {
        const owners = new Set(
          (
            registry.identitiesByObservedName.get(
              normalizedInstructorName(name),
            ) ?? []
          ).map(
            (candidate) => resolvedInstructorIdentity(registry, candidate).uuid,
          ),
        );
        if (owners.size === 1) names.push(name);
      }
    }
    return [...new Set(names)];
  } catch {
    return [];
  }
}

export type InstructorAssociationLookup = {
  uuid: string;
  sourceName: string;
  termCode: string;
  courseCode: string;
};

export async function resolveInstructorAssociations(
  associations: InstructorAssociationLookup[],
) {
  const registry = await instructorRegistry();
  return associations.map((association) => {
    if (associationNeedsResolution(registry, association))
      return { ...association, status: "needs-resolution" as const };
    const identity = registry.identitiesByUuid.get(
      normalizeInstructorKey(association.uuid) ?? "",
    );
    return identity
      ? {
          ...association,
          status: "resolved" as const,
          instructor: resolvedInstructorIdentity(registry, identity),
        }
      : { ...association, status: "unresolved" as const };
  });
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

function explicitTestGeneration() {
  if (!explicitGeneration) throw new RankingsUnavailableError();
  explicitGeneration.loading ??= loadGeneration(explicitGeneration.directory);
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
  if (oldActive) {
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
          // Try the retained previous generation.
        }
      }
    }
    await refreshRankings({}, runtimeDependencies);
    if (runtimeActive) return runtimeActive;
  } catch {
    if (existing) return existing;
  }
  if (existing) return existing;
  throw new RankingsUnavailableError();
}

function generation() {
  configureBrowserTestGeneration();
  if (explicitGeneration) return explicitTestGeneration();
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

async function prepareCandidateManifest(candidate: {
  sha: string;
  directory: string;
  artifacts?: Record<string, { sha256: string; size: number }>;
}) {
  try {
    await stat(resolve(candidate.directory, "manifest.json"));
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    !candidate.artifacts ||
    ARTIFACTS.some((filename) => !candidate.artifacts?.[filename])
  )
    throw new Error("Upstream tree declarations are incomplete");
  const artifacts = Object.fromEntries(
    ARTIFACTS.map((filename) => [filename, candidate.artifacts?.[filename]]),
  );
  try {
    await stat(resolve(candidate.directory, "instructor-identities.parquet"));
  } catch {
    throw new Error(
      "Ranking generation is missing Instructor identity Parquet",
    );
  }
  await writeFile(
    resolve(candidate.directory, "manifest.json"),
    `${JSON.stringify(
      {
        schemaMajor: 0,
        sourceCommit: candidate.sha,
        artifacts,
        identities: [],
        identityEvents: [],
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
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
          await prepareCandidateManifest(candidate);
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

async function clearRankingsRuntimeForTests() {
  const retained = [
    runtimeActive,
    runtimePrevious,
    explicitGeneration?.loading,
  ];
  runtimeActive = undefined;
  runtimePrevious = undefined;
  explicitGeneration = undefined;
  runtimeActiveSha = undefined;
  runtimeCheckedAt = 0;
  runtimeDependencies = undefined;
  runtimeDiscovery = undefined;
  afterAcquireForTests = undefined;
  serializedQueries.clear();
  await Promise.all(retained.map((loading) => retireGeneration(loading)));
}

export async function resetRankingsRuntimeForTests(
  dependencies?: RankingRefreshDependencies,
) {
  await clearRankingsRuntimeForTests();
  runtimeDependencies = dependencies;
}

export async function installRankingGenerationForTests(directory: string) {
  await clearRankingsRuntimeForTests();
  explicitGeneration = { directory };
}

function number(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

type CourseMetadata = {
  title?: string;
  attributes: Array<{ label: string; value: string }>;
};

type Candidate = {
  key: string;
  active: boolean;
  score?: number;
  searchText: string;
  coursePrefix?: string;
  courseCodes: Set<string>;
  commonCore: CommonCoreCategory[];
  evidenceSummary: Pick<RankFields, "ustSpaceSamples" | "sfqSamples">;
  result:
    | Omit<CourseRanking, keyof RankFields | "commonCore">
    | Omit<InstructorRanking, keyof RankFields>;
};

type RankedCandidate = Candidate & { score: number };

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

type RankingsQueryResult = RankingsPage & {
  scoreDistribution: ScoreDistribution;
};
type EntityRankingsQueryResult<Entity extends "course" | "instructor"> =
  RankingsPage<Entity> & Pick<RankingsQueryResult, "scoreDistribution">;

async function queryRankingsWithGeneration(
  query: RankingsQuery,
  accepted: Generation,
): Promise<RankingsQueryResult> {
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
  const commonCoreScheme =
    query.entity === "course" ? (query.commonCoreScheme ?? "CC25") : undefined;
  const commonCoreDefinition = commonCoreScheme
    ? commonCoreSchemes.get(commonCoreScheme)
    : undefined;
  if (commonCoreScheme && !commonCoreDefinition)
    throw new InvalidRankingsQueryError("Invalid Common Core cohort.");
  const commonCoreValues = new Map(
    commonCoreDefinition?.categories.map(({ value, attributeValue }) => [
      value,
      attributeValue,
    ]),
  );
  if (commonCore.some((category) => !commonCoreValues.has(category)))
    throw new InvalidRankingsQueryError(
      "Common Core category does not belong to this cohort.",
    );
  if (
    (query.entity === "course" && course) ||
    (query.entity === "instructor" &&
      (commonCore.length > 0 || query.commonCoreScheme))
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
  const [latest, termRows] = await Promise.all([
    queryRows(
      accepted.connection,
      `SELECT term_code FROM read_parquet('${sqlPath(accepted.directory, rankingFile)}') LIMIT 1`,
    ),
    queryRows(
      accepted.connection,
      `SELECT term_num, term_code FROM read_parquet('${source}') GROUP BY ALL ORDER BY term_num DESC`,
    ),
  ]);
  const terms = termRows.map((row) => {
    const termCode = String(row.term_code);
    return { termCode, termName: rankingTermName(termCode) };
  });
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

  const coursesPath = sqlPath(accepted.directory, "courses.parquet");
  const catalogDigest = accepted.courseDigest;
  const linkRows = await queryRows(
    accepted.connection,
    `SELECT links.uuid, links.name, links.subject, links.code, courses.title FROM read_parquet('${sqlPath(accepted.directory, "course-instructors.parquet")}') links LEFT JOIN read_parquet('${coursesPath}') courses ON courses.prefix = links.subject AND courses.number = links.code WHERE links.term_code = $termCode`,
    { termCode },
  );
  const identitiesByCourse = new Map<string, InstructorIdentity[]>();
  const coursesByInstructor = new Map<string, Set<string>>();
  const courseTitles = new Map<string, string>();
  for (const row of linkRows) {
    const courseKey = `${row.subject}${row.code}`;
    if (row.title) courseTitles.set(courseKey, String(row.title));
    const identity = resolveInstructorAssociation(accepted, {
      uuid: String(row.uuid),
      sourceName: String(row.name),
      termCode,
      courseCode: `${row.subject} ${row.code}`,
    });
    if (identity) {
      const identities = identitiesByCourse.get(courseKey) ?? [];
      if (!identities.some((candidate) => candidate.uuid === identity.uuid))
        identities.push(identity);
      identitiesByCourse.set(courseKey, identities);
      const courses = coursesByInstructor.get(identity.uuid) ?? new Set();
      courses.add(`${row.subject} ${row.code}`);
      coursesByInstructor.set(identity.uuid, courses);
    }
  }

  const rows = await queryRows(
    accepted.connection,
    query.entity === "course"
      ? `SELECT ratings.subject, ratings.code, ratings.criterion, ratings.bayesian, ratings.cumulative_samples, ratings.is_offered AS is_active, courses.title, courses.attributes FROM read_parquet('${source}') ratings LEFT JOIN read_parquet('${coursesPath}') courses ON courses.prefix = ratings.subject AND courses.number = ratings.code WHERE ratings.term_code = $termCode ORDER BY ratings.subject, ratings.code, ratings.criterion`
      : `SELECT uuid, name, criterion, bayesian, cumulative_samples, is_teaching AS is_active FROM read_parquet('${source}') WHERE term_code = $termCode ORDER BY name, criterion`,
    { termCode },
  );
  const evidence = new Map<
    string,
    Partial<Record<Criterion, { bayesian: number; samples: number }>>
  >();
  const activeEntities = new Set<string>();
  const courseMetadata = new Map<string, CourseMetadata>();
  for (const row of rows) {
    const criterion = String(row.criterion) as Criterion;
    if (!CRITERIA.includes(criterion)) continue;
    const key =
      query.entity === "course"
        ? `${row.subject}${row.code}`
        : String(row.uuid);
    if (row.is_active) activeEntities.add(key);
    if (query.entity === "course")
      courseMetadata.set(key, {
        title: row.title ? String(row.title) : undefined,
        attributes:
          (row.attributes as CourseMetadata["attributes"] | undefined) ?? [],
      });
    const values = evidence.get(key) ?? {};
    values[criterion] = {
      bayesian: number(row.bayesian),
      samples: number(row.cumulative_samples),
    };
    evidence.set(key, values);
  }

  const weightedCriteria = Object.keys(configuration.weights) as Criterion[];
  const identitySearchValues = new Map<string, string[]>();
  for (const identity of accepted.identitiesByUuid.values()) {
    const resolved = resolvedInstructorIdentity(accepted, identity);
    const values = identitySearchValues.get(resolved.uuid) ?? [];
    values.push(
      identity.uuid,
      identity.canonicalName,
      ...(identity.itsc ? [identity.itsc] : []),
      ...identity.aliases.map((alias) => alias.name),
    );
    identitySearchValues.set(resolved.uuid, values);
  }
  const currentSurvivorEvidence = new Set(
    query.entity === "instructor" ? evidence.keys() : [],
  );
  const candidates: Candidate[] = [];
  for (const [key, values] of evidence) {
    const score = weightedCriteria.some(
      (criterion) => values[criterion] === undefined,
    )
      ? undefined
      : weightedCriteria.reduce(
          (sum, criterion) =>
            sum +
            (values[criterion]?.bayesian as number) *
              (configuration.weights[criterion] as number),
          0,
        );
    const evidenceSummary = {
      ustSpaceSamples: values.content?.samples ?? 0,
      sfqSamples:
        values[query.entity === "course" ? "course" : "instructor"]?.samples ??
        0,
    };
    if (query.entity === "course") {
      const prefix = key.match(/^[A-Z]+/)?.[0];
      const courseNumber = prefix ? key.slice(prefix.length) : "";
      if (!prefix || !courseNumber) continue;
      const metadata = courseMetadata.get(key);
      const categories = (commonCoreDefinition?.categories ?? [])
        .filter(
          ({ attributeValue }) =>
            metadata?.attributes.some(
              (attribute) =>
                attribute.label === commonCoreScheme &&
                attribute.value === attributeValue,
            ) ?? false,
        )
        .map(({ value }) => value);
      const associated = identitiesByCourse.get(key) ?? [];
      candidates.push({
        key,
        active: activeEntities.has(key),
        score,
        evidenceSummary,
        coursePrefix: prefix,
        courseCodes: new Set([`${prefix} ${courseNumber}`]),
        commonCore: categories,
        searchText: [
          prefix,
          courseNumber,
          `${prefix} ${courseNumber}`,
          metadata?.title,
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
          title: metadata?.title,
        },
      });
    } else {
      const observedIdentity = accepted.identitiesByUuid.get(key);
      if (!observedIdentity) continue;
      const identity = resolvedInstructorIdentity(accepted, observedIdentity);
      const retired = identity.uuid !== key;
      if (retired && currentSurvivorEvidence.has(identity.uuid)) continue;
      const courseCodes = coursesByInstructor.get(identity.uuid) ?? new Set();
      candidates.push({
        key: identity.uuid,
        active: activeEntities.has(key),
        score: retired ? undefined : score,
        evidenceSummary,
        courseCodes,
        commonCore: [],
        searchText: [
          ...(identitySearchValues.get(identity.uuid) ?? []),
          ...[...courseCodes].flatMap((courseCode) => {
            const [prefix, courseNumber] = courseCode.split(" ");
            return [courseCode, courseTitles.get(`${prefix}${courseNumber}`)];
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
  const allTimeEligible = candidates.filter(
    (candidate): candidate is RankedCandidate => candidate.score !== undefined,
  );
  allTimeEligible.sort(
    (left, right) =>
      right.score - left.score || left.key.localeCompare(right.key),
  );
  const currentEligible = allTimeEligible.filter(
    (candidate) => candidate.active,
  );
  const eligible = activity === "current" ? currentEligible : allTimeEligible;
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
  const rankByEntity = ranks(currentEligible);
  const allTimeRankByEntity = ranks(allTimeEligible);
  const filtered = eligible.filter(matchesFilters);
  const searched = search
    ? filtered.filter((candidate) => candidate.searchText.includes(search))
    : filtered;
  const unrankedMatchCount = candidates.filter(
    (candidate) =>
      candidate.score === undefined &&
      (activity === "all" || candidate.active) &&
      matchesFilters(candidate) &&
      (!search || candidate.searchText.includes(search)),
  ).length;

  const normalizedQuery = JSON.stringify({
    entity: query.entity,
    termCode,
    activity,
    search,
    coursePrefix,
    commonCoreScheme,
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
  if (cached) return JSON.parse(cached) as RankingsQueryResult;
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
    const rank = rankByEntity.get(candidate.key);
    const allTimeRank = allTimeRankByEntity.get(candidate.key);
    if (!allTimeRank) throw new Error("Missing rank");
    return {
      ...candidate.result,
      ...candidate.evidenceSummary,
      commonCore:
        candidate.result.entity === "course" ? candidate.commonCore : undefined,
      score: candidate.score,
      rank: rank?.rank,
      rankPopulation: currentEligible.length,
      percentile: rank?.percentile,
      allTimeRank: allTimeRank.rank,
      allTimePopulation: allTimeRank.population,
      allTimePercentile: allTimeRank.percentile,
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
  const scores = eligible.map((candidate) => candidate.score);
  const minimum = scores.length ? Math.min(...scores) : 0;
  const maximum = scores.length ? Math.max(...scores) : 0;
  const bins = Array.from({ length: 20 }, () => 0);
  const range = maximum - minimum || 1;
  for (const score of scores) {
    const index = Math.min(
      bins.length - 1,
      Math.floor(((score - minimum) / range) * bins.length),
    );
    bins[index] += 1;
  }
  const response: RankingsQueryResult = {
    generation: accepted.sha,
    population: {
      entity: query.entity,
      termCode,
      activity,
      size: eligible.length,
      filteredSize: filtered.length,
    },
    configuration,
    terms,
    results,
    nextCursor,
    unrankedMatchCount,
    scoreDistribution: {
      bins,
      count: scores.length,
      maximum,
      minimum,
    },
  };
  serializedQueries.set(cacheKey, JSON.stringify(response));
  if (serializedQueries.size > 256)
    serializedQueries.delete(serializedQueries.keys().next().value as string);
  return response;
}

export type RankingsOptions = {
  activity?: "current" | "all";
  termCode?: string;
  preset?: RankingPreset;
  weights?: RankingWeights;
};

export function getRankings(
  entity:
    | { type: "instructor"; key: string }
    | { type: "instructor"; uuid: string },
  options?: RankingsOptions,
): Promise<Rankings>;
export function getRankings(
  entity: {
    type: "course";
    coursePrefix: string;
    courseNumber: string;
  },
  options?: RankingsOptions,
): Promise<CourseRankings>;
export async function getRankings(
  entity:
    | { type: "instructor"; key: string }
    | { type: "instructor"; uuid: string }
    | {
        type: "course";
        coursePrefix: string;
        courseNumber: string;
      },
  options: RankingsOptions = {},
): Promise<Rankings | CourseRankings> {
  const lease = await acquireGeneration();
  const accepted = lease.accepted;
  try {
    if (entity.type === "course") {
      const coursePrefix = entity.coursePrefix.trim().toUpperCase();
      const courseNumber = entity.courseNumber.trim().toUpperCase();
      if (
        !/^[A-Z]{2,8}$/.test(coursePrefix) ||
        !/^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(courseNumber)
      )
        throw new UnknownRankingsEntityError("Course");
      const courseRows = await queryRows(
        accepted.connection,
        `SELECT courses.title, courses.attributes, ratings.term_code, ratings.criterion, ratings.bayesian, ratings.confidence, ratings.samples, ratings.cumulative_samples FROM read_parquet('${sqlPath(accepted.directory, "courses.parquet")}') courses FULL OUTER JOIN read_parquet('${sqlPath(accepted.directory, "course-ratings.parquet")}') ratings ON ratings.subject = courses.prefix AND ratings.code = courses.number WHERE coalesce(courses.prefix, ratings.subject) = $coursePrefix AND coalesce(courses.number, ratings.code) = $courseNumber ORDER BY ratings.term_num, ratings.criterion`,
        { coursePrefix, courseNumber },
      );
      if (courseRows.length === 0)
        throw new UnknownRankingsEntityError("Course");
      const metadata = courseRows.find((row) => row.title) as
        | { title: string; attributes: CourseMetadata["attributes"] }
        | undefined;
      const ratings = courseRows.filter((row) => row.criterion);
      const courseCode = `${coursePrefix} ${courseNumber}`;
      const page = (await queryRankingsWithGeneration(
        {
          entity: "course",
          activity: options.activity ?? "all",
          termCode: options.termCode,
          preset: options.preset,
          weights: options.weights,
          search: courseCode,
        },
        accepted,
      )) as EntityRankingsQueryResult<"course">;
      const ranking = page.results.find(
        (candidate) => candidate.courseCode === courseCode,
      );
      const terms = new Map<string, RankingTermEvidence>();
      for (const row of ratings) {
        const termCode = String(row.term_code);
        const term = terms.get(termCode) ?? { termCode, criteria: {} };
        term.criteria[String(row.criterion) as Criterion] = {
          bayesian: number(row.bayesian),
          confidence: number(row.confidence),
          samples: number(row.samples),
          cumulativeSamples: number(row.cumulative_samples),
        };
        terms.set(termCode, term);
      }
      const links = await queryRows(
        accepted.connection,
        `SELECT term_code, uuid, name FROM read_parquet('${sqlPath(accepted.directory, "course-instructors.parquet")}') WHERE subject = $coursePrefix AND code = $courseNumber ORDER BY term_num, uuid`,
        { coursePrefix, courseNumber },
      );
      const instructors = links.flatMap((row) => {
        const termCode = String(row.term_code);
        const instructor = resolveInstructorAssociation(accepted, {
          uuid: String(row.uuid),
          sourceName: String(row.name),
          termCode,
          courseCode,
        });
        return instructor ? [{ termCode, instructor }] : [];
      });
      const commonCore = (commonCoreSchemes.get("CC25")?.categories ?? [])
        .filter(
          ({ attributeValue }) =>
            metadata?.attributes.some(
              (attribute) =>
                attribute.label === "CC25" &&
                attribute.value === attributeValue,
            ) ?? false,
        )
        .map(({ value }) => value);
      return {
        generation: accepted.sha,
        population: page.population,
        configuration: page.configuration,
        scoreDistribution: page.scoreDistribution,
        course: {
          coursePrefix,
          courseNumber,
          courseCode,
          title: metadata?.title,
          commonCore,
        },
        ranking,
        terms: [...terms.values()],
        instructors,
      };
    }

    const requestedKey = ("key" in entity ? entity.key : entity.uuid).trim();
    const identity = lookupInstructorIdentity(accepted, requestedKey);
    const page = (await queryRankingsWithGeneration(
      {
        entity: "instructor",
        activity: options.activity ?? "all",
        termCode: options.termCode,
        preset: options.preset,
        weights: options.weights,
        search: identity.instructor.uuid,
      },
      accepted,
    )) as EntityRankingsQueryResult<"instructor">;
    const evidence = await Promise.all(
      identity.family.map(async (familyInstructor) => {
        const uuid = familyInstructor.uuid;
        const name =
          accepted.currentNameByUuid.get(uuid) ??
          familyInstructor.canonicalName;
        const [ratings, courseRows] = await Promise.all([
          queryRows(
            accepted.connection,
            `SELECT term_code, criterion, bayesian, confidence, samples, cumulative_samples FROM read_parquet('${sqlPath(accepted.directory, "instructor-ratings.parquet")}') WHERE uuid = $uuid ORDER BY term_num, criterion`,
            { uuid },
          ),
          queryRows(
            accepted.connection,
            `SELECT term_code, name, subject || ' ' || code AS course_code FROM read_parquet('${sqlPath(accepted.directory, "course-instructors.parquet")}') WHERE uuid = $uuid ORDER BY term_num, subject, code`,
            { uuid },
          ),
        ]);
        const terms = new Map<string, RankingTermEvidence>();
        for (const row of ratings) {
          const termCode = String(row.term_code);
          const term = terms.get(termCode) ?? { termCode, criteria: {} };
          term.criteria[String(row.criterion) as Criterion] = {
            bayesian: number(row.bayesian),
            confidence: number(row.confidence),
            samples: number(row.samples),
            cumulativeSamples: number(row.cumulative_samples),
          };
          terms.set(termCode, term);
        }
        const courses = courseRows.flatMap((row) => {
          const association = {
            uuid,
            sourceName: String(row.name ?? name),
            termCode: String(row.term_code),
            courseCode: String(row.course_code),
          };
          return associationNeedsResolution(accepted, association)
            ? []
            : [
                {
                  termCode: association.termCode,
                  courseCode: association.courseCode,
                },
              ];
        });
        return {
          instructor: familyInstructor,
          terms: [...terms.values()],
          courses,
        };
      }),
    );
    const current = evidence.find(
      (item) => item.instructor.uuid === identity.instructor.uuid,
    ) ?? { instructor: identity.instructor, terms: [], courses: [] };
    const courses = [
      ...new Map(
        evidence
          .flatMap((item) => item.courses)
          .map((association) => [
            `${association.termCode}\0${association.courseCode}`,
            association,
          ]),
      ).values(),
    ];
    return {
      ...identity,
      population: page.population,
      configuration: page.configuration,
      scoreDistribution: page.scoreDistribution,
      ranking: page.results.find(
        (candidate) => candidate.uuid === identity.instructor.uuid,
      ),
      terms: current.terms,
      courses,
      historicalEvidence: evidence.filter(
        (item) =>
          item.instructor.uuid !== identity.instructor.uuid &&
          (item.terms.length > 0 || item.courses.length > 0),
      ),
    };
  } finally {
    await lease.release();
  }
}

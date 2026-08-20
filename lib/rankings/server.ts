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

const LEARNING_WEIGHTS: Record<Criterion, number> = {
  content: 0.2667,
  teaching: 0.2667,
  grading: 0.1,
  workload: 0.0333,
  course: 0.0833,
  instructor: 0.25,
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
  entity: "instructor";
  termCode?: string;
  preset?: "learning";
  activity?: "current" | "all";
  search?: string;
  limit?: number;
};

export type InstructorRanking = {
  uuid: string;
  canonicalName: string;
  score: number;
  globalRank: number;
  localRank: number;
  percentile: number;
};

export type RankingsPage = {
  generation: string;
  population: {
    entity: "instructor";
    termCode: string;
    activity: "current" | "all";
    size: number;
  };
  preset: "learning";
  results: InstructorRanking[];
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
    super("Instructor rankings are unavailable.", options);
    this.name = "RankingsUnavailableError";
  }
}

const generations = new Map<string, Promise<Generation>>();

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
    `SELECT 1 FROM read_parquet(['${courses}', '${courseRanks}', '${instructors}', '${instructorRanks}'], union_by_name=true) WHERE criterion IS NULL OR criterion NOT IN ('content', 'teaching', 'grading', 'workload', 'course', 'instructor') OR rating IS NULL OR bayesian IS NULL OR confidence IS NULL OR effective_samples IS NULL OR reliability IS NULL OR posterior_stddev IS NULL OR NOT isfinite(rating) OR NOT isfinite(bayesian) OR NOT isfinite(confidence) OR NOT isfinite(effective_samples) OR NOT isfinite(reliability) OR NOT isfinite(posterior_stddev)`,
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
  for (const identity of manifest.identities) {
    if (
      !uuidPattern.test(identity.uuid) ||
      uuids.has(identity.uuid) ||
      identity.canonicalName.toLowerCase() === "tba"
    ) {
      throw new Error("Invalid Instructor UUID");
    }
    uuids.add(identity.uuid);
    if (
      identity.aliases.length === 0 ||
      identity.aliases.some(
        (alias) =>
          !alias.name ||
          !["schedule", "review", "sfq", "ranking-generation"].includes(
            alias.source,
          ) ||
          alias.sourceCommit !== manifest.sourceCommit ||
          (alias.source === "ranking-generation" &&
            alias.sourceFile !== "instructor-ratings.parquet"),
      )
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

export async function queryRankings(
  query: RankingsQuery,
): Promise<RankingsPage> {
  if (
    query.entity !== "instructor" ||
    (query.preset && query.preset !== "learning")
  )
    throw new TypeError("Unsupported ranking query");
  const accepted = await generation();
  const source = sqlPath(accepted.directory, "instructor-ratings.parquet");
  const latest = await queryRows(
    accepted.connection,
    `SELECT term_code FROM read_parquet('${sqlPath(accepted.directory, "instructor-rankings.parquet")}') LIMIT 1`,
  );
  const termCode = query.termCode ?? String(latest[0]?.term_code);
  if (!/^[0-9]{4}$/.test(termCode)) throw new TypeError("Invalid Term Code");
  const activity = query.activity ?? "current";
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 100);
  const rows = await queryRows(
    accepted.connection,
    `SELECT name, criterion, bayesian FROM read_parquet('${source}') WHERE term_code = $termCode AND ($current = false OR is_teaching) ORDER BY name, criterion`,
    { termCode, current: activity === "current" },
  );
  const evidence = new Map<string, Partial<Record<Criterion, number>>>();
  for (const row of rows) {
    const criterion = String(row.criterion) as Criterion;
    if (!CRITERIA.includes(criterion)) continue;
    const values = evidence.get(String(row.name)) ?? {};
    values[criterion] = number(row.bayesian);
    evidence.set(String(row.name), values);
  }
  const eligible = [...evidence]
    .filter(([, values]) =>
      CRITERIA.every(
        (criterion) =>
          LEARNING_WEIGHTS[criterion] === 0 || values[criterion] !== undefined,
      ),
    )
    .map(([canonicalName, values]) => ({
      identity: accepted.identitiesByName.get(canonicalName),
      score: CRITERIA.reduce(
        (score, criterion) =>
          score + (values[criterion] ?? 0) * LEARNING_WEIGHTS[criterion],
        0,
      ),
    }))
    .filter(
      (row): row is { identity: InstructorIdentity; score: number } =>
        row.identity !== undefined,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.identity.uuid.localeCompare(right.identity.uuid),
    );

  let rank = 0;
  let previousScore: number | undefined;
  const ranked = eligible.map((row, index) => {
    if (row.score !== previousScore) rank = index + 1;
    previousScore = row.score;
    return {
      uuid: row.identity.uuid,
      canonicalName: row.identity.canonicalName,
      score: row.score,
      globalRank: rank,
      localRank: rank,
      percentile:
        eligible.length === 1
          ? 1
          : (eligible.length - rank) / (eligible.length - 1),
    };
  });
  const search = query.search?.trim().toLocaleLowerCase();
  const results = (
    search
      ? ranked.filter((row) => {
          const identity = accepted.identitiesByUuid.get(row.uuid);
          return (
            row.canonicalName.toLocaleLowerCase().includes(search) ||
            identity?.aliases.some((alias) =>
              alias.name.toLocaleLowerCase().includes(search),
            )
          );
        })
      : ranked
  ).slice(0, limit);
  return {
    generation: accepted.sha,
    population: {
      entity: "instructor",
      termCode,
      activity,
      size: eligible.length,
    },
    preset: "learning",
    results,
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

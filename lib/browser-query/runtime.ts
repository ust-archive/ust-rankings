import * as duckdb from "@duckdb/duckdb-wasm";
import {
  buildInstructorIdentityHistory,
  type InstructorAssociationCorrection,
  type InstructorIdentityHistoryEvent,
} from "@/lib/instructor-identity";
import {
  RANKING_CRITERIA,
  type RankingCriterion,
} from "@/lib/rankings/configuration";
import { rankingTermName } from "@/lib/rankings/presentation";
import {
  normalizeRankingConfiguration,
  rankingPositions,
} from "@/lib/rankings/scoring";
import type {
  CommonCoreCategory,
  CommonCoreScheme,
  CourseRanking,
  CourseRankings,
  InstructorIdentity,
  RankingsPage,
  RankingsQuery,
  ScoreDistribution,
} from "@/lib/rankings/server";
import { DELIVERY_CDN_BASE_URL } from "@/lib/server-index-contract";
import { type PinnedDelivery, resolveDeliveryManifest } from "./manifest";
import type { CourseQueryOperations } from "./protocol";

const asset = (name: string) =>
  new URL(`/duckdb/${name}`, self.location.origin).href;
const bundles: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: asset("duckdb-mvp.wasm"),
    mainWorker: asset("duckdb-browser-mvp.worker.js"),
  },
  eh: {
    mainModule: asset("duckdb-eh.wasm"),
    mainWorker: asset("duckdb-browser-eh.worker.js"),
  },
};
const commonCoreValues: Record<
  CommonCoreScheme,
  Partial<Record<CommonCoreCategory, string>>
> = {
  "4Y": {
    "ssc-humanities": "09",
    "ssc-social-analysis": "10",
    "ssc-science-technology": "11",
    humanities: "12",
    "social-analysis": "13",
    "science-technology": "14",
    "quantitative-reasoning": "15",
    arts: "16",
    "english-communication": "17",
    "chinese-communication": "18",
    health: "19",
  },
  CC22: {
    "critical-thinking-data-literacy": "20",
    "healthy-lifestyle-mindfulness-well-being": "21",
    "english-communication": "22",
    "chinese-communication": "23",
    arts: "24",
    humanities: "25",
    science: "26",
    technology: "27",
    "social-analysis": "28",
    "undergraduate-research": "29",
    "undergraduate-teaching": "30",
    "undergraduate-participation": "31",
    "undergraduate-community": "32",
  },
  CC25: {
    "critical-thinking-data-literacy": "33",
    "healthy-lifestyle-mindfulness-well-being": "34",
    "english-communication": "35",
    "chinese-communication": "36",
    arts: "37",
    humanities: "38",
    science: "39",
    technology: "40",
    "social-analysis": "41",
    sustainability: "42",
    "undergraduate-research": "43",
    "undergraduate-teaching": "44",
    "undergraduate-participation": "45",
    "undergraduate-community": "46",
  },
  CC26: {
    haic: "47",
    "healthy-lifestyle-mindfulness-well-being": "48",
    "english-communication": "49",
    "chinese-communication": "50",
    arts: "51",
    humanities: "52",
    science: "53",
    technology: "54",
    "social-analysis": "55",
    sustainability: "56",
    "undergraduate-research": "57",
    "undergraduate-teaching": "58",
    "undergraduate-participation": "59",
    "undergraduate-community": "60",
  },
};

type Row = Record<string, unknown>;
type CriterionEvidence = {
  bayesian: number;
  confidence: number;
  samples: number;
  cumulativeSamples: number;
};
type Candidate = {
  key: string;
  active: boolean;
  score?: number;
  searchText: string;
  coursePrefix: string;
  commonCore: CommonCoreCategory[];
  evidenceSummary: { ustSpaceSamples: number; sfqSamples: number };
  result: Omit<
    CourseRanking,
    | "score"
    | "rank"
    | "rankPopulation"
    | "percentile"
    | "allTimeRank"
    | "allTimePopulation"
    | "allTimePercentile"
    | "ustSpaceSamples"
    | "sfqSamples"
    | "commonCore"
  >;
};
type RankedCandidate = Candidate & { score: number };
type PageWithDistribution = RankingsPage<"course"> & {
  scoreDistribution: ScoreDistribution;
};
type Runtime = {
  delivery: PinnedDelivery;
  db: duckdb.AsyncDuckDB;
  worker: Worker;
  connection: duckdb.AsyncDuckDBConnection;
  courses: Map<
    string,
    {
      prefix: string;
      number: string;
      title: string;
      attributes: Array<{ label: string; value: string; description: string }>;
    }
  >;
  identities: Map<string, InstructorIdentity>;
  identityHistory: ReturnType<typeof buildInstructorIdentityHistory>;
  cache: Map<string, unknown>;
};

export class QueryError extends Error {
  constructor(
    readonly code: "invalid" | "stale" | "unavailable" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

let runtimePromise: Promise<Runtime> | undefined;
let pinnedBaseUrl: string | undefined;

function plain(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toArray" in value &&
    typeof value.toArray === "function"
  )
    return Array.from(value.toArray() as Iterable<unknown>, plain);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, plain(item)]),
    );
  return value;
}

function rows(table: { toArray(): unknown[] }) {
  return table.toArray().map((row) => plain(row) as Row);
}

async function queryRows(
  runtime: Pick<Runtime, "connection">,
  sql: string,
  parameters: unknown[] = [],
) {
  if (parameters.length === 0) return rows(await runtime.connection.query(sql));
  const statement = await runtime.connection.prepare(sql);
  try {
    return rows(await statement.query(...parameters));
  } finally {
    await statement.close();
  }
}

function number(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new QueryError("unavailable", "Invalid dataset value");
  return parsed;
}

function normalizedWeights(query: RankingsQuery) {
  return normalizeRankingConfiguration(
    query,
    (message) => new QueryError("invalid", message),
  );
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function decodeCursor(cursor: string) {
  try {
    if (cursor.length > 2048) throw new Error("cursor too long");
    const value = JSON.parse(fromBase64Url(cursor)) as Record<string, unknown>;
    if (
      typeof value.g !== "string" ||
      typeof value.c !== "string" ||
      typeof value.q !== "string" ||
      typeof value.p !== "string"
    )
      throw new Error("invalid cursor");
    return value as { g: string; c: string; q: string; p: string };
  } catch {
    throw new QueryError("invalid", "Invalid ranking cursor.");
  }
}

async function sha256Base64Url(value: string) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of hash) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function createRuntimeCandidate(
  baseUrl: string,
  lifecycle: {
    connection?: duckdb.AsyncDuckDBConnection;
    db?: duckdb.AsyncDuckDB;
    worker?: Worker;
  },
): Promise<Runtime> {
  const delivery = await resolveDeliveryManifest(baseUrl);
  const bundle = await duckdb.selectBundle(bundles);
  const worker = await duckdb.createWorker(bundle.mainWorker as string);
  lifecycle.worker = worker;
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  lifecycle.db = db;
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  for (const [name, artifact] of Object.entries(delivery.manifest.artifacts))
    await db.registerFileURL(
      name,
      artifact.url,
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
  const connection = await db.connect();
  lifecycle.connection = connection;
  await connection.query("SET threads = 1");

  const [courseRows, identityRows, aliasRows, eventRows, correctionRows] =
    await Promise.all([
      queryRows(
        { connection },
        "SELECT prefix, number, title, attributes FROM read_parquet('courses.parquet') ORDER BY prefix, number",
      ),
      queryRows(
        { connection },
        "SELECT uuid, canonical_name, itsc FROM read_parquet('instructors.parquet') ORDER BY uuid",
      ),
      queryRows(
        { connection },
        "SELECT uuid, name, source, source_commit, source_file FROM read_parquet('instructor-aliases.parquet') ORDER BY uuid, name",
      ),
      queryRows(
        { connection },
        "SELECT event_type, source_commit, uuid, itsc, retired_uuid, survivor_uuid, source_uuid, new_uuid FROM read_parquet('instructor-identity-events.parquet') ORDER BY source_commit, event_type",
      ),
      queryRows(
        { connection },
        "SELECT correction_type, source_commit, target_uuid, source_name, term_code, course_code FROM read_parquet('instructor-split-associations.parquet') ORDER BY source_commit, correction_type",
      ),
    ]);
  const aliasesByUuid = new Map<string, InstructorIdentity["aliases"]>();
  const aliasCommitsByUuid = new Map<string, string[]>();
  for (const row of aliasRows) {
    const uuid = String(row.uuid).toLowerCase();
    const aliases = aliasesByUuid.get(uuid) ?? [];
    aliases.push({
      name: String(row.name),
      source: String(
        row.source,
      ) as InstructorIdentity["aliases"][number]["source"],
      sourceCommit: String(row.source_commit),
      ...(row.source_file
        ? {
            sourceFile: String(
              row.source_file,
            ) as InstructorIdentity["aliases"][number]["sourceFile"],
          }
        : {}),
    });
    aliasesByUuid.set(uuid, aliases);
    const commits = aliasCommitsByUuid.get(uuid) ?? [];
    commits.push(String(row.source_commit));
    aliasCommitsByUuid.set(uuid, commits);
  }
  const identities = new Map(
    identityRows.map((row) => {
      const uuid = String(row.uuid).toLowerCase();
      return [
        uuid,
        {
          uuid,
          canonicalName: String(row.canonical_name),
          ...(row.itsc ? { itsc: String(row.itsc) } : {}),
          aliases: aliasesByUuid.get(uuid) ?? [],
        } satisfies InstructorIdentity,
      ] as const;
    }),
  );
  const events = eventRows.map((row): InstructorIdentityHistoryEvent => {
    const sourceCommit = String(row.source_commit);
    if (row.event_type === "itsc-added")
      return {
        type: "itsc-added",
        uuid: String(row.uuid),
        itsc: String(row.itsc),
        sourceCommit,
      };
    if (row.event_type === "merge")
      return {
        type: "merge",
        retiredUuid: String(row.retired_uuid),
        survivorUuid: String(row.survivor_uuid),
        sourceCommit,
      };
    return {
      type: "split",
      sourceUuid: String(row.source_uuid),
      newUuid: String(row.new_uuid),
      sourceCommit,
    };
  });
  const corrections = correctionRows.map(
    (row): InstructorAssociationCorrection => ({
      correctionType: String(row.correction_type) as "split" | "calibration",
      sourceCommit: String(row.source_commit),
      targetUuid: String(row.target_uuid),
      sourceName: String(row.source_name),
      ...(row.term_code ? { termCode: String(row.term_code) } : {}),
      courseCode: String(row.course_code),
    }),
  );
  const identityHistory = buildInstructorIdentityHistory({
    sourceCommit: delivery.manifest.sources.rankings,
    identities: [...identities.values()].map((identity) => ({
      uuid: identity.uuid,
      itsc: identity.itsc,
      aliasSourceCommits: aliasCommitsByUuid.get(identity.uuid) ?? [],
    })),
    events,
    associationCorrections: corrections,
  });
  const courses = new Map(
    courseRows.map((row) => {
      const prefix = String(row.prefix);
      const number = String(row.number);
      return [
        `${prefix} ${number}`,
        {
          prefix,
          number,
          title: String(row.title),
          attributes: (row.attributes ?? []) as Runtime["courses"] extends Map<
            string,
            infer Course
          >
            ? Course extends { attributes: infer Attributes }
              ? Attributes
              : never
            : never,
        },
      ] as const;
    }),
  );
  return {
    delivery,
    db,
    worker,
    connection,
    courses,
    identities,
    identityHistory,
    cache: new Map(),
  };
}

async function createRuntime(baseUrl: string) {
  const lifecycle: {
    connection?: duckdb.AsyncDuckDBConnection;
    db?: duckdb.AsyncDuckDB;
    worker?: Worker;
  } = {};
  try {
    return await createRuntimeCandidate(baseUrl, lifecycle);
  } catch (error) {
    await lifecycle.connection?.close().catch(() => undefined);
    await lifecycle.db?.terminate().catch(() => undefined);
    lifecycle.worker?.terminate();
    throw error;
  }
}

function runtime(baseUrl: string) {
  if (pinnedBaseUrl && pinnedBaseUrl !== baseUrl)
    throw new QueryError(
      "unavailable",
      "This tab already pinned another generation.",
    );
  pinnedBaseUrl ??= baseUrl;
  runtimePromise ??= createRuntime(baseUrl);
  return runtimePromise;
}

function resolvedIdentity(runtime: Runtime, uuid: string) {
  // Delivery relation UUIDs are accepted Ranking Generation evidence.
  // Scoped corrections apply earlier when raw Schedule/Review names are resolved.
  return runtime.identities.get(runtime.identityHistory.resolveUuid(uuid));
}

async function catalog(
  runtime: Runtime,
  input: CourseQueryOperations["catalog"]["input"],
) {
  const search = input.search?.trim().toLocaleLowerCase() ?? "";
  if (search.length > 100)
    throw new QueryError("invalid", "Search is limited to 100 characters.");
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 20), 1), 100);
  return [...runtime.courses.values()]
    .filter((course) =>
      `${course.prefix} ${course.number} ${course.title}`
        .toLocaleLowerCase()
        .includes(search),
    )
    .slice(0, limit)
    .map((course) => ({
      coursePrefix: course.prefix,
      courseNumber: course.number,
      courseCode: `${course.prefix} ${course.number}`,
      title: course.title,
    }));
}

async function courseRankings(
  runtime: Runtime,
  query: RankingsQuery & { entity: "course" },
): Promise<PageWithDistribution> {
  const activity = query.activity ?? "current";
  if (activity !== "current" && activity !== "all")
    throw new QueryError("invalid", "Invalid activity mode.");
  const search = query.search?.trim().toLocaleLowerCase() || undefined;
  if (search && search.length > 100)
    throw new QueryError("invalid", "Search is limited to 100 characters.");
  const coursePrefix = query.coursePrefix?.trim().toUpperCase() || undefined;
  if (coursePrefix && !/^[A-Z]{2,8}$/.test(coursePrefix))
    throw new QueryError("invalid", "Invalid Course Prefix.");
  if (query.course)
    throw new QueryError("invalid", "Filter does not apply to this entity.");
  const commonCoreScheme = query.commonCoreScheme ?? "CC25";
  const scheme = commonCoreValues[commonCoreScheme];
  if (!scheme) throw new QueryError("invalid", "Invalid Common Core cohort.");
  const commonCore = [...new Set(query.commonCore ?? [])].sort();
  if (commonCore.some((category) => !scheme[category]))
    throw new QueryError(
      "invalid",
      "Common Core category does not belong to this cohort.",
    );
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 100);
  if (!Number.isFinite(limit))
    throw new QueryError("invalid", "Invalid ranking page size.");
  const configuration = normalizedWeights(query);
  const termRows = await queryRows(
    runtime,
    "SELECT term_num, term_code FROM read_parquet('course-ratings.parquet') GROUP BY ALL ORDER BY term_num DESC",
  );
  const terms = termRows.map((row) => ({
    termCode: String(row.term_code),
    termName: rankingTermName(String(row.term_code)),
  }));
  const termCode = query.termCode?.trim() || terms[0]?.termCode || "";
  if (
    !/^\d{4}$/.test(termCode) ||
    !terms.some((term) => term.termCode === termCode)
  )
    throw new QueryError("invalid", "Unknown Term Code.");
  const normalizedQuery = JSON.stringify({
    entity: "course",
    termCode,
    activity,
    search,
    coursePrefix,
    commonCoreScheme,
    commonCore,
    configuration,
    limit,
  });
  const fingerprint = await sha256Base64Url(normalizedQuery);
  const cacheKey = `courseRankings:${fingerprint}:${query.cursor ?? ""}`;
  const cached = runtime.cache.get(cacheKey);
  if (cached) return cached as PageWithDistribution;

  const ratingRows = await queryRows(
    runtime,
    `SELECT ratings.subject, ratings.code, ratings.criterion, ratings.bayesian,
      ratings.cumulative_samples, ratings.is_offered, courses.title, courses.attributes
     FROM read_parquet('course-ratings.parquet') ratings
     LEFT JOIN read_parquet('courses.parquet') courses
       ON courses.prefix = ratings.subject AND courses.number = ratings.code
     WHERE ratings.term_code = ?
     ORDER BY ratings.subject, ratings.code, ratings.criterion`,
    [termCode],
  );
  const relationRows = await queryRows(
    runtime,
    `SELECT uuid, subject, code FROM read_parquet('relation.parquet')
     WHERE term_code = ? ORDER BY subject, code, uuid`,
    [termCode],
  );
  const identitiesByCourse = new Map<string, InstructorIdentity[]>();
  for (const row of relationRows) {
    const code = `${row.subject} ${row.code}`;
    const identity = resolvedIdentity(runtime, String(row.uuid));
    if (!identity) continue;
    const identities = identitiesByCourse.get(code) ?? [];
    if (!identities.some((candidate) => candidate.uuid === identity.uuid))
      identities.push(identity);
    identitiesByCourse.set(code, identities);
  }
  const evidence = new Map<
    string,
    Partial<Record<RankingCriterion, { bayesian: number; samples: number }>>
  >();
  const active = new Set<string>();
  const metadata = new Map<
    string,
    { title?: string; attributes: Array<{ label: string; value: string }> }
  >();
  for (const row of ratingRows) {
    const criterion = String(row.criterion) as RankingCriterion;
    if (!RANKING_CRITERIA.includes(criterion)) continue;
    const code = `${row.subject} ${row.code}`;
    if (row.is_offered) active.add(code);
    metadata.set(code, {
      title: row.title ? String(row.title) : undefined,
      attributes:
        (row.attributes as Array<{ label: string; value: string }>) ?? [],
    });
    const values = evidence.get(code) ?? {};
    values[criterion] = {
      bayesian: number(row.bayesian),
      samples: number(row.cumulative_samples),
    };
    evidence.set(code, values);
  }
  const weightedCriteria = Object.keys(
    configuration.weights,
  ) as RankingCriterion[];
  const candidates: Candidate[] = [];
  for (const [code, values] of evidence) {
    const [prefix = "", courseNumber = ""] = code.split(" ");
    if (!prefix || !courseNumber) continue;
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
    const courseMetadata = metadata.get(code);
    const categories = (
      Object.entries(scheme) as Array<[CommonCoreCategory, string]>
    )
      .filter(([, attributeValue]) =>
        courseMetadata?.attributes.some(
          (attribute) =>
            attribute.label === commonCoreScheme &&
            attribute.value === attributeValue,
        ),
      )
      .map(([category]) => category);
    const associated = identitiesByCourse.get(code) ?? [];
    candidates.push({
      key: code,
      active: active.has(code),
      score,
      coursePrefix: prefix,
      commonCore: categories,
      evidenceSummary: {
        ustSpaceSamples: values.content?.samples ?? 0,
        sfqSamples: values.course?.samples ?? 0,
      },
      searchText: [
        prefix,
        courseNumber,
        code,
        courseMetadata?.title,
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
        courseCode: code,
        title: courseMetadata?.title,
      },
    });
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
  const matchesFilters = (candidate: Candidate) =>
    (!coursePrefix || candidate.coursePrefix === coursePrefix) &&
    (commonCore.length === 0 ||
      commonCore.some((category) => candidate.commonCore.includes(category)));
  const rankByCourse = rankingPositions(currentEligible);
  const allTimeRankByCourse = rankingPositions(allTimeEligible);
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
  let start = 0;
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    if (
      cursor.g !== runtime.delivery.generation ||
      cursor.c !== runtime.delivery.manifest.artifacts["courses.parquet"].sha256
    )
      throw new QueryError("stale", "Ranking page expired.");
    if (cursor.q !== fingerprint)
      throw new QueryError(
        "invalid",
        "The cursor belongs to a different ranking query.",
      );
    const position = searched.findIndex(
      (candidate) => candidate.key === cursor.p,
    );
    if (position < 0)
      throw new QueryError("invalid", "Invalid ranking cursor position.");
    start = position + 1;
  }
  const page = searched.slice(start, start + limit);
  const results = page.map((candidate): CourseRanking => {
    const rank = rankByCourse.get(candidate.key);
    const allTimeRank = allTimeRankByCourse.get(candidate.key);
    if (!allTimeRank || candidate.score === undefined)
      throw new QueryError("unavailable", "Missing ranking evidence");
    return {
      ...candidate.result,
      ...candidate.evidenceSummary,
      commonCore: candidate.commonCore,
      score: candidate.score,
      rank: rank?.rank,
      rankPopulation: currentEligible.length,
      percentile: rank?.percentile,
      allTimeRank: allTimeRank.rank,
      allTimePopulation: allTimeRank.population,
      allTimePercentile: allTimeRank.percentile,
    };
  });
  const hasMore = start + page.length < searched.length;
  const nextCursor = hasMore
    ? base64Url(
        JSON.stringify({
          g: runtime.delivery.generation,
          c: runtime.delivery.manifest.artifacts["courses.parquet"].sha256,
          q: fingerprint,
          p: page.at(-1)?.key,
        }),
      )
    : undefined;
  const scores = eligible.map((candidate) => candidate.score);
  const minimum = scores.length ? Math.min(...scores) : 0;
  const maximum = scores.length ? Math.max(...scores) : 0;
  const bins = Array.from({ length: 20 }, () => 0);
  const range = maximum - minimum || 1;
  for (const score of scores)
    bins[
      Math.min(
        bins.length - 1,
        Math.floor(((score - minimum) / range) * bins.length),
      )
    ] += 1;
  const response: PageWithDistribution = {
    generation: runtime.delivery.generation,
    population: {
      entity: "course",
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
    scoreDistribution: { bins, count: scores.length, minimum, maximum },
  };
  runtime.cache.set(cacheKey, response);
  if (runtime.cache.size > 256)
    runtime.cache.delete(runtime.cache.keys().next().value as string);
  return response;
}

async function courseDetails(
  runtime: Runtime,
  input: CourseQueryOperations["courseDetails"]["input"],
): Promise<CourseRankings> {
  const coursePrefix = input.coursePrefix.trim().toUpperCase();
  const courseNumber = input.courseNumber.trim().toUpperCase();
  if (
    !/^[A-Z]{2,8}$/.test(coursePrefix) ||
    !/^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(courseNumber)
  )
    throw new QueryError("unknown", "Unknown Course");
  const cacheKey = `courseDetails:${JSON.stringify({ ...input, coursePrefix, courseNumber })}`;
  const cached = runtime.cache.get(cacheKey);
  if (cached) return cached as CourseRankings;
  const courseCode = `${coursePrefix} ${courseNumber}`;
  const ratingRows = await queryRows(
    runtime,
    `SELECT term_code, criterion, bayesian, confidence, samples, cumulative_samples
     FROM read_parquet('course-ratings.parquet')
     WHERE subject = ? AND code = ? ORDER BY term_num, criterion`,
    [coursePrefix, courseNumber],
  );
  const metadata = runtime.courses.get(courseCode);
  if (!metadata && ratingRows.length === 0)
    throw new QueryError("unknown", "Unknown Course");
  const query: RankingsQuery & { entity: "course" } = {
    entity: "course",
    activity: input.activity ?? "all",
    termCode: input.termCode,
    preset: input.preset,
    weights: input.weights,
    search: courseCode,
  };
  let page: PageWithDistribution;
  try {
    page = await courseRankings(runtime, query);
  } catch (error) {
    if (
      !(error instanceof QueryError) ||
      error.code !== "invalid" ||
      !input.termCode
    )
      throw error;
    page = await courseRankings(runtime, { ...query, termCode: undefined });
  }
  const terms = new Map<
    string,
    {
      termCode: string;
      criteria: Partial<Record<RankingCriterion, CriterionEvidence>>;
    }
  >();
  for (const row of ratingRows) {
    const termCode = String(row.term_code);
    const term = terms.get(termCode) ?? { termCode, criteria: {} };
    term.criteria[String(row.criterion) as RankingCriterion] = {
      bayesian: number(row.bayesian),
      confidence: number(row.confidence),
      samples: number(row.samples),
      cumulativeSamples: number(row.cumulative_samples),
    };
    terms.set(termCode, term);
  }
  const links = await queryRows(
    runtime,
    `SELECT term_code, uuid FROM read_parquet('relation.parquet')
     WHERE subject = ? AND code = ? ORDER BY term_num, uuid`,
    [coursePrefix, courseNumber],
  );
  const instructors = links.flatMap((row) => {
    const instructor = resolvedIdentity(runtime, String(row.uuid));
    return instructor ? [{ termCode: String(row.term_code), instructor }] : [];
  });
  const commonCore = (
    Object.entries(commonCoreValues.CC25) as Array<[CommonCoreCategory, string]>
  )
    .filter(([, attributeValue]) =>
      metadata?.attributes.some(
        (attribute) =>
          attribute.label === "CC25" && attribute.value === attributeValue,
      ),
    )
    .map(([category]) => category);
  const result: CourseRankings = {
    generation: runtime.delivery.generation,
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
    ranking: page.results.find(
      (candidate) => candidate.courseCode === courseCode,
    ),
    terms: [...terms.values()],
    instructors,
  };
  runtime.cache.set(cacheKey, result);
  if (runtime.cache.size > 256)
    runtime.cache.delete(runtime.cache.keys().next().value as string);
  return result;
}

export function deliveryBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_DELIVERY_BASE_URL ?? DELIVERY_CDN_BASE_URL
  ).replace(/\/+$/, "");
}

export async function queryCatalog(
  input: CourseQueryOperations["catalog"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  return catalog(await runtime(baseUrl), input);
}

export async function queryCourseRankings(
  input: CourseQueryOperations["courseRankings"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await courseRankings(await runtime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError("unavailable", "Public Course data is unavailable.");
  }
}

export async function queryCourseDetails(
  input: CourseQueryOperations["courseDetails"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await courseDetails(await runtime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError("unavailable", "Public Course data is unavailable.");
  }
}

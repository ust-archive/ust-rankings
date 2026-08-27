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
  rankingScore,
} from "@/lib/rankings/scoring";
import type {
  CommonCoreCategory,
  CommonCoreScheme,
  CourseRanking,
  CourseRankings,
  InstructorIdentity,
  InstructorIdentityLookup,
  InstructorRanking,
  Rankings,
  RankingsPage,
  RankingsQuery,
  ScoreDistribution,
} from "@/lib/rankings/server";
import type {
  CourseOffering,
  ScheduleClass,
  ScheduleDetails,
  ScheduleMeeting,
  SchedulePage,
} from "@/lib/schedule/server";
import {
  DELIVERY_CDN_BASE_URL,
  WAITLIST_EVIDENCE_FILENAME,
} from "@/lib/server-index-contract";
import {
  activationAt,
  bundleTrajectories,
  formatHeadline,
  interval,
  physicalVenueCapacity,
  prediction,
  WAITLIST_MODEL_VERSION,
  WAITLIST_PRIOR_WEIGHT,
  WAITLIST_PRIOR_WEIGHTS,
  WAITLIST_TERMS,
  WAITLIST_TUNING_HOURS,
  WAITLIST_TUNING_POSITIONS,
  type WaitlistBundle,
  type WaitlistFeatures,
  type WaitlistPlanCandidate,
  type WaitlistTrajectory,
  waitlistSeason,
  waitlistTerm,
} from "@/lib/waitlist-evidence";
import { type PinnedDelivery, resolveDeliveryManifest } from "./manifest";
import type {
  CourseQueryOperations,
  WaitlistClass,
  WaitlistComponentResult,
  WaitlistCourseOffering,
  WaitlistPlanInput,
  WaitlistPlanResult,
  WaitlistSearchResult,
  WaitlistTerm,
  WaitlistUnsupportedReason,
} from "./protocol";

const asset = (name: string) =>
  new URL(`/duckdb/1.32.0/${name}`, self.location.origin).href;
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
type InstructorPageWithDistribution = RankingsPage<"instructor"> & {
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
  waitlistRegistered: boolean;
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
  for (const [name, artifact] of Object.entries(delivery.manifest.artifacts)) {
    if (name === WAITLIST_EVIDENCE_FILENAME) continue;
    await db.registerFileURL(
      name,
      artifact.url,
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
  }
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
    waitlistRegistered: false,
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

async function waitlistRuntime(baseUrl: string) {
  const value = await runtime(baseUrl);
  if (value.waitlistRegistered) return value;
  const artifact =
    value.delivery.manifest.artifacts[WAITLIST_EVIDENCE_FILENAME];
  if (!value.delivery.manifest.waitlistEvidence.sourceAvailable || !artifact)
    throw new QueryError(
      "unavailable",
      "Public Waitlist Evidence data is unavailable.",
    );
  try {
    await value.db.registerFileURL(
      WAITLIST_EVIDENCE_FILENAME,
      artifact.url,
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
    value.waitlistRegistered = true;
    return value;
  } catch {
    throw new QueryError(
      "unavailable",
      "Public Waitlist Evidence data is unavailable.",
    );
  }
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
  const candidates: Candidate[] = [];
  for (const [code, values] of evidence) {
    const [prefix = "", courseNumber = ""] = code.split(" ");
    if (!prefix || !courseNumber) continue;
    const score = rankingScore(values, configuration.weights);
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

function instructorIdentity(runtime: Runtime, inputKey: string) {
  const key = inputKey.trim().toLowerCase();
  const requestedUuid = runtime.identities.has(key)
    ? key
    : runtime.identityHistory.uuidByItsc.get(key);
  if (!requestedUuid) throw new QueryError("unknown", "Unknown Instructor");
  const uuid = runtime.identityHistory.resolveUuid(requestedUuid);
  const instructor = runtime.identities.get(uuid);
  if (!instructor) throw new QueryError("unknown", "Unknown Instructor");
  const family = [...runtime.identities.values()].filter(
    (candidate) => runtime.identityHistory.resolveUuid(candidate.uuid) === uuid,
  );
  const familyUuids = family.map((candidate) => candidate.uuid);
  const familySet = new Set(familyUuids);
  const canonicalKey = instructor.itsc ?? instructor.uuid;
  return {
    generation: runtime.delivery.generation,
    instructor,
    family,
    familyUuids,
    route: { canonicalKey, redirect: key !== canonicalKey },
    identityHistory: {
      identifiers: family.flatMap(
        (candidate) =>
          runtime.identityHistory.identifiersByUuid.get(candidate.uuid) ?? [],
      ),
      events: runtime.identityHistory.events.filter((event) => {
        if (event.type === "itsc-added") return familySet.has(event.uuid);
        if (event.type === "merge")
          return (
            familySet.has(event.retiredUuid) ||
            familySet.has(event.survivorUuid)
          );
        return familySet.has(event.sourceUuid) || familySet.has(event.newUuid);
      }),
      associationCorrections: runtime.identityHistory
        .correctionsForUuids(familySet)
        .map((correction) => {
          if (correction.correctionType === "split")
            return {
              ...correction,
              correctionType: "split" as const,
              status: "needs-resolution" as const,
            };
          return {
            ...correction,
            correctionType: "calibration" as const,
            status: "resolved" as const,
          };
        }),
    },
  } satisfies InstructorIdentityLookup;
}

async function instructorRankings(
  runtime: Runtime,
  query: RankingsQuery & { entity: "instructor" },
): Promise<InstructorPageWithDistribution> {
  const activity = query.activity ?? "current";
  if (activity !== "current" && activity !== "all")
    throw new QueryError("invalid", "Invalid activity mode.");
  if (query.commonCore?.length || query.commonCoreScheme)
    throw new QueryError("invalid", "Filter does not apply to this entity.");
  const search = query.search?.trim().toLocaleLowerCase() || undefined;
  if (search && search.length > 100)
    throw new QueryError("invalid", "Search is limited to 100 characters.");
  const coursePrefix = query.coursePrefix?.trim().toUpperCase() || undefined;
  if (coursePrefix && !/^[A-Z]{2,8}$/.test(coursePrefix))
    throw new QueryError("invalid", "Invalid Course Prefix.");
  const course = query.course?.trim().toUpperCase() || undefined;
  if (course && !/^[A-Z]{2,8} [0-9]{3,5}[A-Z]?$/.test(course))
    throw new QueryError("invalid", "Invalid Course Code.");
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 100);
  if (!Number.isFinite(limit))
    throw new QueryError("invalid", "Invalid ranking page size.");
  const configuration = normalizeRankingConfiguration(
    query,
    (message) => new QueryError("invalid", message),
  );
  const termRows = await queryRows(
    runtime,
    "SELECT term_num, term_code FROM read_parquet('instructor-ratings.parquet') GROUP BY ALL ORDER BY term_num DESC",
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
    entity: "instructor",
    termCode,
    activity,
    search,
    coursePrefix,
    course,
    configuration,
    limit,
  });
  const fingerprint = await sha256Base64Url(normalizedQuery);
  const cacheKey = `instructorRankings:${fingerprint}:${query.cursor ?? ""}`;
  const cached = runtime.cache.get(cacheKey);
  if (cached) return cached as InstructorPageWithDistribution;
  const [ratingRows, relationRows] = await Promise.all([
    queryRows(
      runtime,
      `SELECT uuid, criterion, bayesian, cumulative_samples, is_teaching
       FROM read_parquet('instructor-ratings.parquet') WHERE term_code = ?
       ORDER BY uuid, criterion`,
      [termCode],
    ),
    queryRows(
      runtime,
      `SELECT uuid, subject, code FROM read_parquet('relation.parquet')
       WHERE term_code = ? ORDER BY uuid, subject, code`,
      [termCode],
    ),
  ]);
  const coursesByInstructor = new Map<string, Set<string>>();
  for (const row of relationRows) {
    const uuid = runtime.identityHistory.resolveUuid(String(row.uuid));
    const courses = coursesByInstructor.get(uuid) ?? new Set<string>();
    courses.add(`${row.subject} ${row.code}`);
    coursesByInstructor.set(uuid, courses);
  }
  const evidence = new Map<
    string,
    Partial<Record<RankingCriterion, { bayesian: number; samples: number }>>
  >();
  const active = new Set<string>();
  for (const row of ratingRows) {
    const criterion = String(row.criterion) as RankingCriterion;
    if (!RANKING_CRITERIA.includes(criterion)) continue;
    const uuid = String(row.uuid);
    if (row.is_teaching) active.add(uuid);
    const values = evidence.get(uuid) ?? {};
    values[criterion] = {
      bayesian: number(row.bayesian),
      samples: number(row.cumulative_samples),
    };
    evidence.set(uuid, values);
  }
  const currentEvidence = new Set(evidence.keys());
  const familySearchValues = new Map<string, string[]>();
  for (const identity of runtime.identities.values()) {
    const uuid = runtime.identityHistory.resolveUuid(identity.uuid);
    const values = familySearchValues.get(uuid) ?? [];
    values.push(
      identity.uuid,
      identity.canonicalName,
      ...(identity.itsc ? [identity.itsc] : []),
      ...identity.aliases.map((alias) => alias.name),
    );
    familySearchValues.set(uuid, values);
  }
  const candidates: Array<{
    key: string;
    active: boolean;
    score?: number;
    searchText: string;
    courseCodes: Set<string>;
    result: Omit<
      InstructorRanking,
      | "score"
      | "rank"
      | "rankPopulation"
      | "percentile"
      | "allTimeRank"
      | "allTimePopulation"
      | "allTimePercentile"
      | "ustSpaceSamples"
      | "sfqSamples"
    >;
    ustSpaceSamples: number;
    sfqSamples: number;
  }> = [];
  for (const [observedUuid, values] of evidence) {
    const identity = resolvedIdentity(runtime, observedUuid);
    if (!identity) continue;
    const retired = identity.uuid !== observedUuid;
    if (retired && currentEvidence.has(identity.uuid)) continue;
    const courseCodes = coursesByInstructor.get(identity.uuid) ?? new Set();
    candidates.push({
      key: identity.uuid,
      active: active.has(observedUuid),
      score: retired ? undefined : rankingScore(values, configuration.weights),
      courseCodes,
      searchText: [
        ...(familySearchValues.get(identity.uuid) ?? []),
        ...[...courseCodes].flatMap((code) => [
          code,
          runtime.courses.get(code)?.title,
        ]),
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
      ustSpaceSamples: values.content?.samples ?? 0,
      sfqSamples: values.instructor?.samples ?? 0,
    });
  }
  const allTimeEligible = candidates.filter(
    (candidate): candidate is (typeof candidates)[number] & { score: number } =>
      candidate.score !== undefined,
  );
  allTimeEligible.sort(
    (left, right) =>
      right.score - left.score || left.key.localeCompare(right.key),
  );
  const currentEligible = allTimeEligible.filter(
    (candidate) => candidate.active,
  );
  const eligible = activity === "current" ? currentEligible : allTimeEligible;
  const matchesFilters = (candidate: (typeof candidates)[number]) =>
    (!coursePrefix ||
      [...candidate.courseCodes].some((code) =>
        code.startsWith(`${coursePrefix} `),
      )) &&
    (!course || candidate.courseCodes.has(course));
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
      cursor.c !==
        runtime.delivery.manifest.artifacts["instructors.parquet"].sha256
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
  const rankByInstructor = rankingPositions(currentEligible);
  const allTimeRanks = rankingPositions(allTimeEligible);
  const page = searched.slice(start, start + limit);
  const results = page.map((candidate): InstructorRanking => {
    const rank = rankByInstructor.get(candidate.key);
    const allTime = allTimeRanks.get(candidate.key) as NonNullable<
      ReturnType<typeof allTimeRanks.get>
    >;
    return {
      ...candidate.result,
      score: candidate.score,
      rank: rank?.rank,
      rankPopulation: currentEligible.length,
      percentile: rank?.percentile,
      allTimeRank: allTime.rank,
      allTimePopulation: allTime.population,
      allTimePercentile: allTime.percentile,
      ustSpaceSamples: candidate.ustSpaceSamples,
      sfqSamples: candidate.sfqSamples,
    };
  });
  const hasMore = start + page.length < searched.length;
  const nextCursor = hasMore
    ? base64Url(
        JSON.stringify({
          g: runtime.delivery.generation,
          c: runtime.delivery.manifest.artifacts["instructors.parquet"].sha256,
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
    bins[Math.min(19, Math.floor(((score - minimum) / range) * 20))] += 1;
  const response: InstructorPageWithDistribution = {
    generation: runtime.delivery.generation,
    population: {
      entity: "instructor",
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

async function instructorDetails(
  runtime: Runtime,
  input: CourseQueryOperations["instructorDetails"]["input"],
): Promise<Rankings> {
  const identity = instructorIdentity(runtime, input.key);
  const query: RankingsQuery & { entity: "instructor" } = {
    entity: "instructor",
    activity: input.activity ?? "all",
    termCode: input.termCode,
    preset: input.preset,
    weights: input.weights,
    search: identity.instructor.uuid,
  };
  let page: InstructorPageWithDistribution;
  try {
    page = await instructorRankings(runtime, query);
  } catch (error) {
    if (
      !(error instanceof QueryError) ||
      error.code !== "invalid" ||
      !input.termCode
    )
      throw error;
    page = await instructorRankings(runtime, { ...query, termCode: undefined });
  }
  const evidence = await Promise.all(
    identity.family.map(async (familyInstructor) => {
      const [ratings, relations] = await Promise.all([
        queryRows(
          runtime,
          `SELECT term_code, criterion, bayesian, confidence, samples, cumulative_samples
           FROM read_parquet('instructor-ratings.parquet') WHERE uuid = ?
           ORDER BY term_num, criterion`,
          [familyInstructor.uuid],
        ),
        queryRows(
          runtime,
          `SELECT term_code, subject || ' ' || code AS course_code
           FROM read_parquet('relation.parquet') WHERE uuid = ?
           ORDER BY term_num, subject, code`,
          [familyInstructor.uuid],
        ),
      ]);
      const terms = new Map<
        string,
        { termCode: string; criteria: Record<string, unknown> }
      >();
      for (const row of ratings) {
        const termCode = String(row.term_code);
        const term = terms.get(termCode) ?? { termCode, criteria: {} };
        term.criteria[String(row.criterion)] = {
          bayesian: number(row.bayesian),
          confidence: number(row.confidence),
          samples: number(row.samples),
          cumulativeSamples: number(row.cumulative_samples),
        };
        terms.set(termCode, term);
      }
      return {
        instructor: familyInstructor,
        terms: [...terms.values()] as Rankings["terms"],
        courses: relations.map((row) => ({
          termCode: String(row.term_code),
          courseCode: String(row.course_code),
        })),
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
}

const waitlistEnrollmentStartsSql = Object.entries(WAITLIST_TERMS)
  .map(
    ([termCode, term]) =>
      `WHEN '${termCode}' THEN TIMESTAMPTZ '${term.enrollmentStart}'`,
  )
  .join(" ");

const scheduleOfferingSql = `
  WITH courses AS (
    SELECT * EXCLUDE (rn) FROM (
      SELECT *, row_number() OVER (PARTITION BY term_num, id ORDER BY timestamp DESC) rn
      FROM read_parquet('schedule-courses.parquet')
    ) WHERE rn = 1 AND status = 'ACTIVE'
  ), classes AS (
    SELECT * EXCLUDE (rn) FROM (
      SELECT *,
        min(timestamp) FILTER (
          WHERE greatest(wait, 0) > 0
            AND timestamp >= CASE term_code ${waitlistEnrollmentStartsSql} ELSE NULL END
        ) OVER (PARTITION BY term_num, course_id, section) activation_at,
        row_number() OVER (PARTITION BY term_num, course_id, section ORDER BY timestamp DESC) rn
      FROM read_parquet('schedule-classes.parquet')
    ) WHERE rn = 1 AND status = 'ACTIVE'
  )
  SELECT course.term_num, course.term_code, course.term_name, course.id course_id,
    course.prefix, course.number course_number, course.career, course.title,
    course.description, course.credits, course.previous, course.prerequisite,
    course.corequisite, course.exclusion, course.attributes,
    class.section, class.number class_number, class.role, class.type class_type,
    class.association, class.remarks, class.capacity, class.enroll, class.wait,
    class.consent, class.open, class.schedules, class.reservations,
    class.activation_at::VARCHAR activation_at, class.timestamp::VARCHAR observed_at
  FROM courses course JOIN classes class
    ON course.term_num = class.term_num AND course.id = class.course_id`;

function scheduleText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function scheduleDate(value: unknown) {
  if (!value) return undefined;
  if (typeof value === "number") {
    const milliseconds =
      value > 1_000_000_000_000
        ? value
        : value > 1_000_000
          ? value * 1000
          : value * 86_400_000;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }
  return scheduleText(value).slice(0, 10);
}

function scheduleTime(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.slice(0, 5);
  const minutes = Math.floor(number(value) / 60_000_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

async function mapScheduleRows(runtime: Runtime, source: Row[]) {
  const relationRows = await queryRows(
    runtime,
    "SELECT uuid, term_code, subject, code FROM read_parquet('relation.parquet')",
  );
  const relations = new Map<string, string[]>();
  for (const row of relationRows) {
    const key = `${row.term_code}\0${row.subject} ${row.code}`;
    const values = relations.get(key) ?? [];
    values.push(String(row.uuid));
    relations.set(key, values);
  }
  const names = new Map<string, string[]>();
  for (const identity of runtime.identities.values())
    names.set(identity.uuid, [
      identity.canonicalName,
      ...identity.aliases.map((alias) => alias.name),
    ]);
  const resolveName = (sourceName: string, termCode: string, code: string) => {
    const candidates = relations.get(`${termCode}\0${code}`) ?? [];
    const correction = runtime.identityHistory.matchAssociation({
      sourceName,
      termCode,
      courseCode: code,
    });
    if (correction && candidates.includes(correction.targetUuid))
      return correction.targetUuid;
    const matching = candidates.filter((uuid) =>
      (names.get(uuid) ?? []).some(
        (name) => name.trim().toLowerCase() === sourceName.trim().toLowerCase(),
      ),
    );
    if (matching.length !== 1) return undefined;
    const resolution = runtime.identityHistory.resolveAssociation({
      sourceName,
      termCode,
      courseCode: code,
      uuid: matching[0],
    });
    return resolution.status === "resolved" ? resolution.uuid : undefined;
  };
  const offerings = new Map<string, CourseOffering>();
  for (const row of source) {
    const key = `${row.term_num}\0${row.course_id}`;
    let offering = offerings.get(key);
    if (!offering) {
      const coursePrefix = scheduleText(row.prefix);
      const courseNumber = scheduleText(row.course_number);
      offering = {
        termNumber: number(row.term_num),
        termCode: scheduleText(row.term_code),
        termName: scheduleText(row.term_name),
        courseId: scheduleText(row.course_id),
        coursePrefix,
        courseNumber,
        courseCode: `${coursePrefix} ${courseNumber}`,
        career: scheduleText(row.career) as CourseOffering["career"],
        title: scheduleText(row.title),
        description: scheduleText(row.description),
        credits: number(row.credits),
        previousCourseCodes: scheduleText(row.previous),
        prerequisite: scheduleText(row.prerequisite),
        corequisite: scheduleText(row.corequisite),
        exclusion: scheduleText(row.exclusion),
        attributes: ((row.attributes as Row[] | undefined) ?? []).map(
          (attribute) => ({
            label: scheduleText(attribute.label),
            value: scheduleText(attribute.value),
            description: scheduleText(attribute.description),
          }),
        ),
        classes: [],
      };
      offerings.set(key, offering);
    }
    const meetings = ((row.schedules as Row[] | undefined) ?? []).map(
      (meeting): ScheduleMeeting => ({
        weekday: scheduleText(meeting.weekday) as ScheduleMeeting["weekday"],
        dateFrom: scheduleDate(meeting.date_from),
        dateTo: scheduleDate(meeting.date_to),
        timeFrom: scheduleTime(meeting.time_from),
        timeTo: scheduleTime(meeting.time_to),
        room: scheduleText(meeting.venue_name) || scheduleText(meeting.venue),
        roomCode: scheduleText(meeting.venue),
        instructors: (
          (meeting.instructors as unknown[] | undefined) ?? []
        ).flatMap((value) => {
          const sourceName = scheduleText(value).trim();
          if (!sourceName || sourceName.toLowerCase() === "tba") return [];
          const uuid = resolveName(
            sourceName,
            offering.termCode,
            offering.courseCode,
          );
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
      section: scheduleText(row.section),
      classNumber: number(row.class_number),
      role: scheduleText(row.role) as ScheduleClass["role"],
      classType: scheduleText(row.class_type) as ScheduleClass["classType"],
      association:
        row.association === null || row.association === undefined
          ? undefined
          : number(row.association),
      remarks: scheduleText(row.remarks),
      capacity: number(row.capacity),
      enrollment: number(row.enroll),
      waitlist: number(row.wait),
      consent: Boolean(row.consent),
      open: Boolean(row.open),
      meetings,
      reservations: ((row.reservations as Row[] | undefined) ?? []).map(
        (reservation) => ({
          name: scheduleText(reservation.name),
          quota: number(reservation.quota),
          enrollment: number(reservation.enroll),
        }),
      ),
    });
  }
  return [...offerings.values()].sort(
    (left, right) =>
      left.termNumber - right.termNumber ||
      left.courseCode.localeCompare(right.courseCode),
  );
}

function scheduleSearchText(offering: CourseOffering) {
  return [
    offering.courseCode,
    offering.title,
    offering.description,
    offering.previousCourseCodes,
    offering.prerequisite,
    offering.corequisite,
    offering.exclusion,
    ...offering.attributes.flatMap((attribute) => Object.values(attribute)),
    ...offering.classes.flatMap((item) => [
      item.section,
      item.classNumber,
      item.remarks,
      ...item.meetings.flatMap((meeting) => [
        meeting.room,
        meeting.roomCode,
        ...meeting.instructors.map((instructor) => instructor.sourceName),
      ]),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

async function schedulePage(
  runtime: Runtime,
  input: CourseQueryOperations["schedulePage"]["input"],
): Promise<SchedulePage> {
  const termRows = await queryRows(
    runtime,
    "SELECT term_num, term_code, term_name FROM read_parquet('schedule-courses.parquet') GROUP BY ALL ORDER BY term_num",
  );
  const terms = termRows.map((row) => ({
    termNumber: number(row.term_num),
    termCode: scheduleText(row.term_code),
    termName: scheduleText(row.term_name),
  }));
  const termCode = input.termCode?.trim() || terms.at(-1)?.termCode || "";
  const term = terms.find((candidate) => candidate.termCode === termCode);
  if (!term) throw new QueryError("invalid", "Unknown Term Code.");
  const search = input.search?.trim();
  if (search && search.length > 100)
    throw new QueryError("invalid", "Search is limited to 100 characters.");
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 100);
  const rows = await queryRows(
    runtime,
    `${scheduleOfferingSql} WHERE course.term_code = ? ORDER BY course.prefix, course.number, class.section`,
    [termCode],
  );
  let offerings = await mapScheduleRows(runtime, rows);
  if (search) {
    const normalized = search.toLowerCase();
    offerings = offerings.filter((offering) =>
      scheduleSearchText(offering).includes(normalized),
    );
  }
  return {
    generation: runtime.delivery.generation,
    terms,
    term,
    search,
    total: offerings.length,
    results: offerings.slice(0, limit),
  };
}

async function scheduleDetails(
  runtime: Runtime,
  entity: CourseQueryOperations["scheduleDetails"]["input"],
): Promise<ScheduleDetails> {
  if (entity.type === "instructor") {
    const wanted = new Set(
      entity.uuids.map((uuid) => runtime.identityHistory.resolveUuid(uuid)),
    );
    const relationRows = await queryRows(
      runtime,
      "SELECT uuid, term_code, subject, code FROM read_parquet('relation.parquet')",
    );
    const associations = relationRows.filter((row) =>
      wanted.has(runtime.identityHistory.resolveUuid(String(row.uuid))),
    );
    if (!associations.length)
      return { type: "instructor", instructorUuids: [...wanted], classes: [] };
    const where = associations
      .map(
        () =>
          "(course.term_code = ? AND course.prefix = ? AND course.number = ?)",
      )
      .join(" OR ");
    const parameters = associations.flatMap((row) => [
      row.term_code,
      row.subject,
      row.code,
    ]);
    const rows = await queryRows(
      runtime,
      `${scheduleOfferingSql} WHERE ${where} ORDER BY course.term_num, course.prefix, course.number, class.section`,
      parameters,
    );
    const classes = (await mapScheduleRows(runtime, rows))
      .flatMap((offering) => offering.classes)
      .filter((item) =>
        item.meetings.some((meeting) =>
          meeting.instructors.some(
            (instructor) => instructor.uuid && wanted.has(instructor.uuid),
          ),
        ),
      );
    return { type: "instructor", instructorUuids: [...wanted], classes };
  }
  const coursePrefix = entity.coursePrefix.trim().toUpperCase();
  const courseNumber = entity.courseNumber.trim().toUpperCase();
  if (
    !/^[A-Z]{2,8}$/.test(coursePrefix) ||
    !/^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(courseNumber)
  )
    throw new QueryError("invalid", "Invalid Course.");
  const parameters: unknown[] = [coursePrefix, courseNumber];
  let where = "course.prefix = ? AND course.number = ?";
  if (entity.type !== "course") {
    where += " AND course.term_code = ?";
    parameters.push(entity.termCode);
  }
  const rows = await queryRows(
    runtime,
    `${scheduleOfferingSql} WHERE ${where} ORDER BY course.term_num, class.section`,
    parameters,
  );
  const offerings = await mapScheduleRows(runtime, rows);
  if (!offerings.length)
    throw new QueryError("unknown", "Unknown Schedule entity.");
  if (entity.type === "course")
    return {
      type: "course",
      coursePrefix,
      courseNumber,
      courseCode: `${coursePrefix} ${courseNumber}`,
      offerings,
    };
  const offering = offerings[0] as CourseOffering;
  if (entity.type === "course-offering")
    return { type: "course-offering", ...offering };
  const section = entity.section.trim().toUpperCase();
  const scheduleClass = offering.classes.find(
    (item) => item.section === section,
  );
  if (!scheduleClass) throw new QueryError("unknown", "Unknown Class.");
  return { type: "class", ...scheduleClass };
}

type WaitlistCurrentClass = {
  value: WaitlistClass;
  association?: number;
  courseCode: string;
  activationAtMs?: number;
  observedAtMs?: number;
  features: WaitlistFeatures;
};

type WaitlistHistoricalData = {
  bundles: WaitlistBundle[];
};

function sameNumbers(left: readonly number[], right: readonly number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function waitlistMetadata(runtime: Runtime) {
  const metadata = runtime.delivery.manifest.waitlistEvidence;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.modelVersion !== WAITLIST_MODEL_VERSION ||
    metadata.sourceArtifact !== "classes_legacy.parquet" ||
    metadata.sourceRevision !== runtime.delivery.manifest.sources.schedule ||
    metadata.selectedModel !== "baseline" ||
    metadata.priorWeight !== WAITLIST_PRIOR_WEIGHT ||
    metadata.timing.activation !== "first-positive-wait" ||
    metadata.timing.normalEnrollment !== "official-registry" ||
    metadata.timing.addDrop !== "official-registry" ||
    !sameNumbers(
      metadata.timing.sinceActivationBucketsHours,
      WAITLIST_TUNING_HOURS,
    ) ||
    metadata.timing.sinceEnrollmentBucketDays !== 2 ||
    metadata.timing.untilAddDropBucketDays !== 3 ||
    !sameNumbers(metadata.tuning.positions, WAITLIST_TUNING_POSITIONS) ||
    !sameNumbers(metadata.tuning.activationHours, WAITLIST_TUNING_HOURS) ||
    !sameNumbers(metadata.tuning.priorWeights, WAITLIST_PRIOR_WEIGHTS) ||
    metadata.tuning.holdout !== "whole-term" ||
    metadata.uncertainty !== "estimated-bounded-margin-not-calibrated-interval"
  )
    throw new QueryError(
      "unavailable",
      "Public Waitlist Evidence metadata is unavailable.",
    );
  return metadata;
}

function waitlistTermValue(
  runtime: Runtime,
  termCode: string,
  termNumber: number,
  termName: string,
): WaitlistTerm {
  const info = waitlistTerm(termCode);
  const season = waitlistSeason(termCode);
  const declared = waitlistMetadata(runtime).terms.find(
    (term) => term.termCode === termCode,
  );
  if (!info || !season || !declared)
    throw new QueryError(
      "unavailable",
      "Public Waitlist Evidence metadata is unavailable.",
    );
  if (
    declared.season !== season ||
    declared.enrollmentStart !== info.enrollmentStart ||
    declared.addDropEnd !== info.addDropEnd ||
    declared.source !== info.source
  )
    throw new QueryError(
      "unavailable",
      "Public Waitlist Evidence metadata is unavailable.",
    );
  return {
    termNumber,
    termCode,
    termName,
    season,
    enrollmentStart: info.enrollmentStart,
    addDropEnd: info.addDropEnd,
    source: info.source,
  };
}

async function currentWaitlistTerm(runtime: Runtime): Promise<WaitlistTerm> {
  const [row] = await queryRows(
    runtime,
    `SELECT term_num, term_code, term_name
     FROM read_parquet('schedule-courses.parquet')
     GROUP BY ALL ORDER BY term_num DESC LIMIT 1`,
  );
  const code = row ? scheduleText(row.term_code) : "";
  if (!row || !waitlistSeason(code) || !waitlistTerm(code))
    throw new QueryError(
      "unavailable",
      row
        ? `Current Term ${scheduleText(row.term_name) || code} is unsupported.`
        : "No current Term is available.",
    );
  return waitlistTermValue(
    runtime,
    code,
    number(row.term_num),
    scheduleText(row.term_name),
  );
}

function waitlistRecords(
  value: unknown,
  label: string,
): Record<string, unknown>[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new QueryError("unavailable", `Invalid Waitlist ${label}.`);
    }
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => !item || typeof item !== "object")
  )
    throw new QueryError("unavailable", `Invalid Waitlist ${label}.`);
  return parsed as Record<string, unknown>[];
}

function waitlistTimestamp(value: unknown): { iso?: string; ms?: number } {
  if (value === null || value === undefined || value === "") return {};
  const micros =
    value && typeof value === "object" && "micros" in value
      ? Number((value as { micros: unknown }).micros)
      : undefined;
  const ms =
    micros !== undefined
      ? micros / 1_000
      : value instanceof Date
        ? value.getTime()
        : Date.parse(String(value));
  if (!Number.isFinite(ms))
    throw new QueryError("unavailable", "Invalid Waitlist observation time.");
  return { iso: new Date(ms).toISOString(), ms };
}

function waitlistCount(value: unknown, label: string) {
  if (value === null || value === undefined || value === "")
    throw new QueryError("unavailable", `Invalid Waitlist ${label}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new QueryError("unavailable", `Invalid Waitlist ${label}.`);
  return parsed;
}

function waitlistWait(value: unknown) {
  if (value === null || value === undefined || value === "")
    throw new QueryError("unavailable", "Invalid Waitlist waitlist.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new QueryError("unavailable", "Invalid Waitlist waitlist.");
  return Math.max(0, parsed);
}

function waitlistBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0 || value === null || value === undefined)
    return false;
  throw new QueryError("unavailable", "Invalid Waitlist boolean value.");
}

function waitlistInstructorKey(schedules: readonly Record<string, unknown>[]) {
  return [
    ...new Set(
      schedules.flatMap((meeting) =>
        (Array.isArray(meeting.instructors) ? meeting.instructors : []).flatMap(
          (value) => {
            const name = String(value).trim();
            return name && name.toLowerCase() !== "tba" ? [name] : [];
          },
        ),
      ),
    ),
  ]
    .sort()
    .join("|");
}

function waitlistMeetingKey(schedules: readonly Record<string, unknown>[]) {
  return JSON.stringify(
    schedules.map((meeting) => ({
      weekday: meeting.weekday ?? null,
      dateFrom: meeting.date_from ?? null,
      dateTo: meeting.date_to ?? null,
      timeFrom: meeting.time_from ?? null,
      timeTo: meeting.time_to ?? null,
      venue: meeting.venue ?? null,
      venueName: meeting.venue_name ?? null,
    })),
  );
}

function waitlistFeatures(
  capacity: number,
  enrollment: number,
  schedules: readonly Record<string, unknown>[],
  reservations: readonly Record<string, unknown>[],
): WaitlistFeatures {
  const venueCapacity = physicalVenueCapacity(
    schedules.flatMap((meeting) => [meeting.venue_name, meeting.venue]),
  );
  return {
    capacity,
    enroll: enrollment,
    instructor: waitlistInstructorKey(schedules),
    meeting: waitlistMeetingKey(schedules),
    reservationEnroll: reservations.reduce(
      (sum, reservation) =>
        sum +
        waitlistCount(
          reservation.enroll ?? reservation.enrollment,
          "reservation enrollment",
        ),
      0,
    ),
    reservationQuota: reservations.reduce(
      (sum, reservation) =>
        sum + waitlistCount(reservation.quota, "reservation quota"),
      0,
    ),
    ...(venueCapacity === undefined ? {} : { venueCapacity }),
  };
}

function waitlistUnsupported(
  runtime: Runtime,
  reason: WaitlistUnsupportedReason,
  message: string,
  term?: WaitlistTerm,
  course?: string,
): WaitlistPlanResult {
  return {
    status: "unsupported",
    generation: runtime.delivery.generation,
    ...(term ? { term } : {}),
    ...(course ? { course } : {}),
    reason,
    message,
  };
}

function waitlistClassFromRow(
  row: Row,
  courseCode: string,
): WaitlistCurrentClass {
  const section = scheduleText(row.section).trim().toUpperCase();
  const classType = scheduleText(row.class_type).trim().toUpperCase();
  if (!section || !["LEC", "TUT", "LAB", "IND"].includes(classType))
    throw new QueryError("unavailable", "Invalid Waitlist Class data.");
  const schedules = waitlistRecords(row.schedules, "schedule data");
  const reservations = waitlistRecords(row.reservations, "reservation data");
  const capacity = waitlistCount(row.capacity, "capacity");
  const enrollment = waitlistCount(row.enroll, "enrollment");
  const waitlist = waitlistWait(row.wait);
  const timestamp = waitlistTimestamp(row.observed_at);
  const activation = waitlistTimestamp(row.activation_at);
  const consent = waitlistBoolean(row.consent);
  const open = waitlistBoolean(row.open);
  const reservationValues = reservations.map((reservation) => ({
    name: scheduleText(reservation.name),
    quota: waitlistCount(reservation.quota, "reservation quota"),
    enrollment: waitlistCount(
      reservation.enroll ?? reservation.enrollment,
      "reservation enrollment",
    ),
  }));
  const normalEnrollmentStart = waitlistTerm(
    scheduleText(row.term_code),
  )?.enrollmentStart;
  const hasActivation =
    activation.ms !== undefined &&
    timestamp.ms !== undefined &&
    activation.ms <= timestamp.ms &&
    (normalEnrollmentStart === undefined ||
      activation.ms >= Date.parse(normalEnrollmentStart));
  const reason = consent
    ? "consent-required"
    : waitlist <= 0
      ? "non-waitlisted"
      : !timestamp.iso
        ? "missing-date"
        : !hasActivation
          ? "missing-activation"
          : undefined;
  const association =
    row.association === null || row.association === undefined
      ? undefined
      : waitlistCount(row.association, "association");
  return {
    value: {
      section,
      classNumber: waitlistCount(row.class_number, "Class number"),
      classType: classType as WaitlistClass["classType"],
      capacity,
      enrollment,
      waitlist,
      consent,
      open,
      ...(timestamp.iso ? { observedAt: timestamp.iso } : {}),
      schedules,
      reservations: reservationValues,
      eligible: !reason,
      ...(reason ? { unsupportedReason: reason } : {}),
    },
    association,
    courseCode,
    ...(activation.ms === undefined ? {} : { activationAtMs: activation.ms }),
    ...(timestamp.ms === undefined ? {} : { observedAtMs: timestamp.ms }),
    features: waitlistFeatures(capacity, enrollment, schedules, reservations),
  };
}

function waitlistOfferings(rows: readonly Row[]): WaitlistCourseOffering[] {
  const offerings = new Map<string, WaitlistCourseOffering>();
  for (const row of rows) {
    const prefix = scheduleText(row.prefix).trim().toUpperCase();
    const courseNumber = scheduleText(row.course_number).trim().toUpperCase();
    const courseCode = `${prefix} ${courseNumber}`;
    if (!prefix || !courseNumber)
      throw new QueryError("unavailable", "Invalid Waitlist Course data.");
    const offering = offerings.get(courseCode) ?? {
      coursePrefix: prefix,
      courseNumber,
      courseCode,
      title: scheduleText(row.title),
      classes: [],
    };
    const current = waitlistClassFromRow(row, courseCode);
    offering.classes.push(current.value);
    offerings.set(courseCode, offering);
  }
  return [...offerings.values()]
    .map((offering) => ({
      ...offering,
      classes: offering.classes.sort((left, right) =>
        left.section.localeCompare(right.section),
      ),
    }))
    .sort((left, right) => left.courseCode.localeCompare(right.courseCode));
}

function waitlistSearchText(offering: WaitlistCourseOffering) {
  return [
    offering.courseCode,
    offering.title,
    ...offering.classes.flatMap((item) => [
      item.section,
      String(item.classNumber),
      item.classType,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

async function waitlistClassStatus(
  runtime: Runtime,
  termCode: string,
  coursePrefix: string,
  courseNumber: string,
  section: string,
) {
  const rows = await queryRows(
    runtime,
    `WITH courses AS (
       SELECT * EXCLUDE (rn) FROM (
         SELECT *, row_number() OVER (PARTITION BY term_num, id ORDER BY timestamp DESC) rn
         FROM read_parquet('schedule-courses.parquet')
       ) WHERE rn = 1
     ), classes AS (
       SELECT * EXCLUDE (rn) FROM (
         SELECT *, row_number() OVER (PARTITION BY term_num, course_id, section ORDER BY timestamp DESC) rn
         FROM read_parquet('schedule-classes.parquet')
       ) WHERE rn = 1
     )
     SELECT classes.status::VARCHAR AS status
     FROM courses JOIN classes
       ON courses.term_num = classes.term_num AND courses.id = classes.course_id
     WHERE courses.term_code = ? AND upper(courses.prefix) = ? AND upper(courses.number) = ?
       AND upper(classes.section) = ?
     ORDER BY classes.timestamp DESC LIMIT 1`,
    [termCode, coursePrefix, courseNumber, section],
  );
  return rows[0]?.status
    ? String(rows[0].status).trim().toUpperCase()
    : undefined;
}

async function waitlistSearch(
  runtime: Runtime,
  input: CourseQueryOperations["waitlistSearch"]["input"],
): Promise<WaitlistSearchResult> {
  const search =
    input?.search === undefined
      ? undefined
      : typeof input.search === "string"
        ? input.search.trim()
        : (() => {
            throw new QueryError("invalid", "Invalid Waitlist search.");
          })();
  if (search && search.length > 100)
    throw new QueryError("invalid", "Search is limited to 100 characters.");
  const limitValue = input?.limit ?? 100;
  const limit =
    typeof limitValue === "number" ? Math.floor(limitValue) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new QueryError("invalid", "Invalid Waitlist page size.");
  const term = await currentWaitlistTerm(runtime);
  const rows = await queryRows(
    runtime,
    `${scheduleOfferingSql} WHERE course.term_code = ? ORDER BY course.prefix, course.number, class.section`,
    [term.termCode],
  );
  const offerings = waitlistOfferings(rows);
  const results = search
    ? offerings.filter((offering) =>
        waitlistSearchText(offering).includes(search.toLocaleLowerCase()),
      )
    : offerings;
  return {
    generation: runtime.delivery.generation,
    term,
    ...(search ? { search } : {}),
    total: results.length,
    results: results.slice(0, limit),
  };
}

function waitlistHistoricalData(rows: readonly Row[]): WaitlistHistoricalData {
  const grouped = new Map<
    string,
    {
      trajectory: WaitlistTrajectory;
      features: Array<{ at: number; value: WaitlistFeatures }>;
    }
  >();
  for (const row of rows) {
    const term = scheduleText(row.term_code);
    const course = scheduleText(row.course_code).trim().toUpperCase();
    const section = scheduleText(row.section).trim().toUpperCase();
    const type = scheduleText(row.class_type).trim().toUpperCase();
    if (
      !term ||
      !course ||
      !section ||
      !["LEC", "TUT", "LAB", "IND"].includes(type)
    )
      throw new QueryError("unavailable", "Invalid Waitlist history data.");
    if (waitlistBoolean(row.consent)) continue;
    const timestamp = waitlistTimestamp(row.observed_at);
    if (timestamp.ms === undefined)
      throw new QueryError("unavailable", "Waitlist history is missing dates.");
    const schedules = waitlistRecords(row.schedules, "schedule data");
    const reservations = waitlistRecords(row.reservations, "reservation data");
    const capacity = waitlistCount(row.capacity, "capacity");
    const enrollment = waitlistCount(row.enrollment, "enrollment");
    const wait = waitlistWait(row.waitlist);
    const features = waitlistFeatures(
      capacity,
      enrollment,
      schedules,
      reservations,
    );
    const association =
      row.association === null || row.association === undefined
        ? undefined
        : waitlistCount(row.association, "association");
    const groupKey = `${term}\0${course}\0${association === undefined ? "offering" : association}\0${type}\0${section}`;
    const value = grouped.get(groupKey) ?? {
      trajectory: {
        association,
        course,
        events: [],
        section,
        term,
        type,
      },
      features: [],
    };
    value.trajectory.events.push({ at: timestamp.ms, wait });
    value.features.push({ at: timestamp.ms, value: features });
    grouped.set(groupKey, value);
  }
  const trajectories = [...grouped.values()].map(({ trajectory, features }) => {
    const paired = trajectory.events
      .map((event, index) => ({ event, features: features[index] }))
      .sort(
        (left, right) =>
          left.event.at - right.event.at ||
          left.features.at - right.features.at,
      );
    trajectory.events = paired.map(({ event }) => event);
    const activation = activationAt(trajectory);
    trajectory.activationFeatures =
      activation === undefined
        ? undefined
        : paired.find(({ event }) => event.at === activation && event.wait > 0)
            ?.features.value;
    return trajectory;
  });
  return { bundles: bundleTrajectories(trajectories) };
}

function waitlistCandidate(
  term: WaitlistTerm,
  courseCode: string,
  selected: readonly WaitlistCurrentClass[],
  positions: ReadonlyMap<string, number>,
): WaitlistPlanCandidate {
  const activationAtValues: Record<string, number> = {};
  const activationHours: Record<string, number> = {};
  const features: Record<string, WaitlistFeatures> = {};
  const positionValues: Record<string, number> = {};
  for (const item of selected) {
    const type = item.value.classType;
    const position = positions.get(item.value.section) as number;
    const observedAt = item.observedAtMs;
    const activation = item.activationAtMs;
    if (observedAt === undefined || activation === undefined) continue;
    activationAtValues[type] = activation;
    activationHours[type] = Math.max(0, (observedAt - activation) / 3_600_000);
    features[type] = item.features;
    positionValues[type] = position;
  }
  return {
    activationAt: activationAtValues,
    activationHours,
    course: courseCode,
    features,
    pattern: [...new Set(selected.map((item) => item.value.classType))]
      .sort()
      .join("+"),
    positions: positionValues,
    season: term.season,
    term: term.termCode,
  };
}

async function waitlistPlan(
  runtime: Runtime,
  input: WaitlistPlanInput,
): Promise<WaitlistPlanResult> {
  const termCode =
    typeof input?.termCode === "string" ? input.termCode.trim() : "";
  const coursePrefix =
    typeof input?.coursePrefix === "string"
      ? input.coursePrefix.trim().toUpperCase()
      : "";
  const courseNumber =
    typeof input?.courseNumber === "string"
      ? input.courseNumber.trim().toUpperCase()
      : "";
  if (!/^\d{4}$/.test(termCode))
    throw new QueryError("invalid", "Invalid Waitlist Term Code.");
  if (
    !/^[A-Z]{2,8}$/.test(coursePrefix) ||
    !/^[0-9]{3,5}(?:[A-Z]|-[0-9]{3,5})?$/.test(courseNumber)
  )
    throw new QueryError("invalid", "Invalid Waitlist Course.");
  if (!Array.isArray(input?.classes) || input.classes.length === 0)
    throw new QueryError(
      "invalid",
      "A Waitlist Plan needs one required Class.",
    );
  const entries = input.classes.map((item) => ({
    section:
      typeof item?.section === "string"
        ? item.section.trim().toUpperCase()
        : "",
    position: typeof item?.position === "number" ? item.position : Number.NaN,
  }));
  if (
    entries.some(
      ({ section, position }) =>
        !section || !Number.isSafeInteger(position) || position <= 0,
    )
  )
    throw new QueryError(
      "invalid",
      "Waitlist positions must be positive integers.",
    );
  if (new Set(entries.map(({ section }) => section)).size !== entries.length)
    return waitlistUnsupported(
      runtime,
      "duplicate-class",
      "A Waitlist Plan cannot repeat a Class.",
    );
  const requestedCourse = `${coursePrefix} ${courseNumber}`;
  const term = await currentWaitlistTerm(runtime);
  if (termCode !== term.termCode)
    return waitlistUnsupported(
      runtime,
      "unsupported-term",
      "Historical or unsupported Terms cannot be selected.",
      term,
      requestedCourse,
    );
  const rows = await queryRows(
    runtime,
    `${scheduleOfferingSql} WHERE course.term_code = ? AND upper(course.prefix) = ? AND upper(course.number) = ? ORDER BY class.section`,
    [termCode, coursePrefix, courseNumber],
  );
  if (!rows.length)
    return waitlistUnsupported(
      runtime,
      "class-not-found",
      "The current Course Offering is unavailable.",
      term,
      requestedCourse,
    );
  const current = rows.map((row) => waitlistClassFromRow(row, requestedCourse));
  const selected: WaitlistCurrentClass[] = [];
  for (const entry of entries) {
    const item = current.find(({ value }) => value.section === entry.section);
    if (!item) {
      const status = await waitlistClassStatus(
        runtime,
        termCode,
        coursePrefix,
        courseNumber,
        entry.section,
      );
      return waitlistUnsupported(
        runtime,
        status === "INACTIVE" ? "inactive" : "class-not-found",
        status === "INACTIVE"
          ? `Class ${entry.section} is inactive.`
          : `Class ${entry.section} is unavailable.`,
        term,
        requestedCourse,
      );
    }
    if (!item.value.eligible)
      return waitlistUnsupported(
        runtime,
        item.value.unsupportedReason as WaitlistUnsupportedReason,
        `Class ${entry.section} is unsupported.`,
        term,
        requestedCourse,
      );
    if (entry.position > item.value.waitlist)
      return waitlistUnsupported(
        runtime,
        "stale-position",
        `Class ${entry.section} no longer has that queue position.`,
        term,
        requestedCourse,
      );
    selected.push(item);
  }
  if (
    new Set(selected.map((item) => item.value.classType)).size !==
    selected.length
  )
    return waitlistUnsupported(
      runtime,
      "duplicate-component",
      "A Waitlist Plan cannot repeat a component type.",
      term,
      requestedCourse,
    );
  const metadata = waitlistMetadata(runtime);
  const historyRows = await queryRows(
    runtime,
    `SELECT term_code, course_code, section, association, class_type, class_number,
      capacity, enrollment, waitlist, consent, schedules, reservations,
      observed_at::VARCHAR AS observed_at, source_order
     FROM read_parquet('${WAITLIST_EVIDENCE_FILENAME}')
     ORDER BY term_code, course_code, association, class_type, section, observed_at, source_order`,
  );
  const historical = waitlistHistoricalData(historyRows);
  const candidate = waitlistCandidate(
    term,
    requestedCourse,
    selected,
    new Map(entries.map(({ section, position }) => [section, position])),
  );
  const training = historical.bundles.filter((bundle) => {
    const info = waitlistTerm(bundle.term);
    return (
      bundle.term !== termCode &&
      info !== undefined &&
      Date.parse(info.addDropEnd) < Date.parse(term.addDropEnd)
    );
  });
  const predicted = prediction(
    training,
    candidate,
    "baseline",
    metadata.priorWeight,
  );
  if (!predicted)
    return waitlistUnsupported(
      runtime,
      "no-history",
      "No comparable historical queue evidence is available.",
      term,
      requestedCourse,
    );
  const uncertainty = interval(
    predicted.estimate,
    predicted.local.length,
    metadata.priorWeight,
  );
  const localComponentResults: WaitlistComponentResult[] = [];
  for (const item of selected) {
    const type = item.value.classType;
    const outcomes = predicted.local
      .map((result) => result.components[type])
      .filter(Boolean);
    const netValues = outcomes.map((result) => result.net);
    const grossValues = outcomes.map((result) => result.gross);
    const successes = outcomes.filter((result) => result.success).length;
    const localStats = {
      samples: outcomes.length,
      successes,
      ...(netValues.length
        ? {
            averageNetReduction:
              netValues.reduce((a, b) => a + b, 0) / netValues.length,
          }
        : {}),
      ...(grossValues.length
        ? {
            averageGrossExits:
              grossValues.reduce((a, b) => a + b, 0) / grossValues.length,
          }
        : {}),
      ...(netValues.length
        ? {
            minimumNetReduction: Math.min(...netValues),
            maximumNetReduction: Math.max(...netValues),
          }
        : {}),
    };
    const venueCapacity =
      item.features.venueCapacity !== undefined &&
      item.features.venueCapacity >= item.value.capacity
        ? item.features.venueCapacity
        : undefined;
    const capacities = venueCapacity
      ? training
          .filter((bundle) => bundle.course === requestedCourse)
          .flatMap((bundle) =>
            bundle.components
              .filter(({ type: componentType }) => componentType === type)
              .flatMap(({ trajectory }) => {
                const features = trajectory.activationFeatures;
                return features &&
                  features.capacity > item.value.capacity &&
                  features.venueCapacity !== undefined &&
                  features.venueCapacity > venueCapacity
                  ? [features.capacity]
                  : [];
              }),
          )
      : [];
    const largerCapacity = capacities.reduce<number | undefined>(
      (largest, capacity) =>
        largest === undefined ? capacity : Math.max(largest, capacity),
      undefined,
    );
    const venueScenario =
      venueCapacity === undefined
        ? { name: "venue" as const, status: "unknown" as const }
        : {
            name: "venue" as const,
            capacity: venueCapacity,
            status: "known" as const,
          };
    localComponentResults.push({
      type,
      section: item.value.section,
      classNumber: item.value.classNumber,
      position: entries.find(({ section }) => section === item.value.section)
        ?.position as number,
      ...(candidate.activationAt?.[type] === undefined
        ? {}
        : {
            activationAt: new Date(candidate.activationAt[type]).toISOString(),
          }),
      ...(item.value.observedAt ? { observedAt: item.value.observedAt } : {}),
      ...(candidate.activationHours?.[type] === undefined
        ? {}
        : { activationHours: candidate.activationHours[type] }),
      current: {
        capacity: item.value.capacity,
        enrollment: item.value.enrollment,
        waitlist: item.value.waitlist,
        consent: item.value.consent,
        open: item.value.open,
        reservations: item.value.reservations,
      },
      historical: localStats,
      capacityScenarios: [
        { name: "current", capacity: item.value.capacity, status: "known" },
        venueScenario,
        ...(largerCapacity
          ? [
              {
                name: "historical-large" as const,
                capacity: largerCapacity,
                status: "known" as const,
              },
            ]
          : [
              { name: "historical-large" as const, status: "unknown" as const },
            ]),
      ],
    });
  }
  return {
    status: "supported",
    generation: runtime.delivery.generation,
    term,
    course: requestedCourse,
    model: metadata,
    headline: formatHeadline(
      predicted.estimate,
      predicted.local.length,
      metadata.priorWeight,
    ),
    estimate: predicted.estimate,
    margin: uncertainty.margin,
    range: { low: uncertainty.low, high: uncertainty.high },
    exactHistoryCount: predicted.local.length,
    broaderHistoryCount: predicted.priorSamples,
    prior: {
      rate: predicted.prior,
      samples: predicted.priorSamples,
      weight: metadata.priorWeight,
      influence:
        metadata.priorWeight / (predicted.local.length + metadata.priorWeight),
    },
    smoothing: {
      successes: predicted.successes,
      priorRate: predicted.prior,
      priorWeight: metadata.priorWeight,
      exactSamples: predicted.local.length,
      numerator: predicted.successes + metadata.priorWeight * predicted.prior,
      denominator: predicted.local.length + metadata.priorWeight,
      estimate: predicted.estimate,
    },
    joint: { successes: predicted.successes, samples: predicted.local.length },
    components: localComponentResults,
    sourceObservationTime: selected
      .map((item) => item.value.observedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) as string,
  };
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

export async function queryInstructorRankings(
  input: CourseQueryOperations["instructorRankings"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await instructorRankings(await runtime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError(
      "unavailable",
      "Public Instructor data is unavailable.",
    );
  }
}

export async function queryInstructorDetails(
  input: CourseQueryOperations["instructorDetails"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await instructorDetails(await runtime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError(
      "unavailable",
      "Public Instructor data is unavailable.",
    );
  }
}

export async function querySchedulePage(
  input: CourseQueryOperations["schedulePage"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await schedulePage(await runtime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError("unavailable", "Public Schedule data is unavailable.");
  }
}

export async function queryScheduleDetails(
  input: CourseQueryOperations["scheduleDetails"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await scheduleDetails(await runtime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError("unavailable", "Public Schedule data is unavailable.");
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

export async function queryWaitlistSearch(
  input: CourseQueryOperations["waitlistSearch"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await waitlistSearch(await runtime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError(
      "unavailable",
      "Public Waitlist Evidence data is unavailable.",
    );
  }
}

export async function queryWaitlistPlan(
  input: CourseQueryOperations["waitlistPlan"]["input"],
  baseUrl = deliveryBaseUrl(),
) {
  try {
    return await waitlistPlan(await waitlistRuntime(baseUrl), input);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw new QueryError(
      "unavailable",
      "Public Waitlist Evidence data is unavailable.",
    );
  }
}

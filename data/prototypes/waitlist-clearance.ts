// PROTOTYPE: tests whether aggregate quota history can support honest queue evidence.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  bundleTrajectories,
  formatHeadline,
  interval as jointInterval,
  jointOutcome,
  physicalVenueCapacity,
  WAITLIST_PRIOR_WEIGHT,
  WAITLIST_TERMS,
  type WaitlistTrajectory,
} from "../src/waitlist-evidence.ts";

const terms = WAITLIST_TERMS;
type TermCode = keyof typeof terms;
type HistoricalTerm = Exclude<TermCode, "2610">;
const validationArgument = process.argv.find((argument) =>
  argument.startsWith("--validate-term="),
);
const validationTerm = validationArgument?.slice("--validate-term=".length);
if (
  validationArgument &&
  (!validationTerm || !Object.hasOwn(terms, validationTerm))
)
  throw new Error("Validation Term must be a supported Term Code");
const historicalTermCodes = Object.keys(terms).filter(
  (term): term is HistoricalTerm => term !== "2610",
);
const extractionTermCodes = validationTerm
  ? [...new Set([...historicalTermCodes, validationTerm as TermCode])]
  : historicalTermCodes;
const extractionTerms = extractionTermCodes
  .map((term) => `'${term}'`)
  .join(", ");
const enrollmentStarts = Object.entries(WAITLIST_TERMS)
  .map(
    ([term, value]) =>
      `WHEN '${term}' THEN TIMESTAMPTZ '${value.enrollmentStart}'`,
  )
  .join(" ");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(
  root,
  validationTerm
    ? `data/prototypes/waitlist-clearance-validation-${validationTerm}.md`
    : "data/prototypes/waitlist-clearance-report.md",
);
const unifiedClasses =
  process.env.WAITLIST_CLASSES_PATH ??
  (existsSync(
    resolve(root, ".preview/schedule/canonical/class_records.parquet"),
  )
    ? resolve(root, ".preview/schedule/canonical/class_records.parquet")
    : "https://huggingface.co/datasets/ust-archive/schedule/resolve/main/canonical/class_records.parquet");
const scheduleCourses =
  process.env.WAITLIST_COURSES_PATH ??
  (existsSync(resolve(root, ".preview/schedule/courses.parquet"))
    ? resolve(root, ".preview/schedule/courses.parquet")
    : "https://huggingface.co/datasets/ust-archive/schedule/resolve/main/courses.parquet");
const scheduleClasses =
  process.env.WAITLIST_SCHEDULE_CLASSES_PATH ??
  (existsSync(resolve(root, ".preview/schedule/classes.parquet"))
    ? resolve(root, ".preview/schedule/classes.parquet")
    : "https://huggingface.co/datasets/ust-archive/schedule/resolve/main/classes.parquet");

function sqlPath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll("'", "''");
}

async function sourceRevision(path: string): Promise<string> {
  if (path.startsWith("http")) return "main (remote; not pinned)";
  for (const manifestPath of [
    resolve(dirname(path), "manifest.json"),
    resolve(dirname(dirname(path)), "manifest.json"),
  ])
    try {
      const value = JSON.parse(await readFile(manifestPath, "utf8")) as {
        sourceCommit?: unknown;
      };
      if (typeof value.sourceCommit === "string") return value.sourceCommit;
    } catch {
      // Try the parent directory because canonical artifacts share its manifest.
    }
  return "unrecorded";
}
type Event = { at: number; wait: number };
type Features = {
  capacity: number;
  enroll: number;
  instructor: string;
  meeting: string;
  reservationEnroll: number;
  reservationQuota: number;
  venueCapacity?: number;
};
type PrecomputedOutcome = {
  gross: number;
  hours: number;
  net: number;
  position: number;
  start: number;
  success: boolean;
};
type Trajectory = {
  activationAt?: number;
  activationFeatures?: Features;
  association?: number;
  course: string;
  deadlineFeatures?: Features;
  deadlineWait?: number;
  events: Event[];
  outcomes?: Map<string, PrecomputedOutcome>;
  section: string;
  term: TermCode;
  type: string;
};
type ModelName =
  | "global"
  | "baseline"
  | "capacity"
  | "instructor"
  | "meeting"
  | "all";
type CurrentClass = Features & {
  activation: number;
  timestamp: number;
  venue: string;
  wait: number;
};

async function extractTrajectories(): Promise<Trajectory[]> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    if (unifiedClasses.startsWith("http"))
      await connection.run("INSTALL httpfs; LOAD httpfs;");
    await connection.run("SET threads = 1");
    // Keep the wide event scan and movement calculation in DuckDB.
    const reader = await connection.runAndReadAll(`
      WITH source_base AS (
        SELECT term_code::VARCHAR AS term,
          upper(trim(course_code))::VARCHAR AS course,
          section::VARCHAR AS section, association::INTEGER AS association,
          CASE
            WHEN nullif(trim(type::VARCHAR), '') IS NOT NULL
              THEN upper(trim(type::VARCHAR))
            WHEN regexp_matches(section, '^LA', 'i') THEN 'LAB'
            WHEN regexp_matches(section, '^L', 'i') THEN 'LEC'
            WHEN regexp_matches(section, '^T', 'i') THEN 'TUT'
            ELSE 'IND'
          END::VARCHAR AS class_type,
          capacity::INTEGER AS capacity, enroll::INTEGER AS enroll,
          greatest(wait, 0)::INTEGER AS wait,
          schedules, reservations,
          "timestamp"::TIMESTAMPTZ AS observed_at,
          coalesce(source_order, -1)::BIGINT AS source_order,
          coalesce(version, '')::VARCHAR AS source_version,
          CASE term_code ${enrollmentStarts}
            ELSE NULL::TIMESTAMPTZ
          END AS enrollment_start,
          CASE term_code
            WHEN '2410' THEN TIMESTAMPTZ '${terms["2410"].addDropEnd}'
            WHEN '2430' THEN TIMESTAMPTZ '${terms["2430"].addDropEnd}'
            WHEN '2510' THEN TIMESTAMPTZ '${terms["2510"].addDropEnd}'
            WHEN '2530' THEN TIMESTAMPTZ '${terms["2530"].addDropEnd}'
            WHEN '2610' THEN TIMESTAMPTZ '${terms["2610"].addDropEnd}'
            ELSE NULL::TIMESTAMPTZ
          END AS add_drop_end
        FROM read_parquet('${sqlPath(unifiedClasses)}')
        WHERE term_code IN (${extractionTerms})
          AND course_code IS NOT NULL
          AND section IS NOT NULL
          AND "timestamp" IS NOT NULL
      ), source AS (
        SELECT *, concat_ws('|', term, course, section,
          coalesce(association::VARCHAR, 'offering'), class_type) AS trajectory_id
        FROM source_base
      ), ordered AS (
        SELECT *,
          lag(wait) OVER (
            PARTITION BY trajectory_id
            ORDER BY observed_at, source_order, source_version
          ) AS previous_wait,
          lag(observed_at) OVER (
            PARTITION BY trajectory_id
            ORDER BY observed_at, source_order, source_version
          ) AS previous_observed
        FROM source
      ), changed AS (
        SELECT *, row_number() OVER (
          PARTITION BY trajectory_id
          ORDER BY observed_at, source_order, source_version
        ) AS event_no
        FROM ordered
        WHERE previous_wait IS NULL
          OR wait <> previous_wait
          OR (
            previous_observed < enrollment_start
            AND observed_at >= enrollment_start
          )
      ), activation AS (
        SELECT * FROM changed
        WHERE wait > 0 AND observed_at >= enrollment_start
        QUALIFY row_number() OVER (
          PARTITION BY trajectory_id ORDER BY event_no
        ) = 1
      ), deadline AS (
        SELECT * FROM changed
        WHERE observed_at <= add_drop_end
        QUALIFY row_number() OVER (
          PARTITION BY trajectory_id ORDER BY event_no DESC
        ) = 1
      ), selected AS (
        SELECT * FROM activation
        UNION
        SELECT * FROM deadline
      ), feature_values AS (
        SELECT trajectory_id, event_no, capacity, enroll,
          coalesce((
            SELECT min(trim(name))
            FROM unnest(schedules) AS schedule,
              unnest(schedule.unnest.instructors) AS instructor(name)
            WHERE trim(name) <> '' AND lower(trim(name)) <> 'tba'
          ), 'TBA')::VARCHAR AS instructor,
          coalesce((
            SELECT string_agg(
              coalesce(schedule.unnest.weekday, '') || '@' ||
                left(cast(schedule.unnest.time_from AS VARCHAR), 2),
              '|' ORDER BY coalesce(schedule.unnest.weekday, ''),
                left(cast(schedule.unnest.time_from AS VARCHAR), 2)
            )
            FROM unnest(schedules) AS schedule
            WHERE schedule.unnest.time_from IS NOT NULL
          ), '')::VARCHAR AS meeting,
          (
            SELECT max(try_cast(regexp_extract(
              coalesce(schedule.unnest.venue_name, schedule.unnest.venue),
              '\\\\((\\\\d+)\\\\)\\\\s*$', 1
            ) AS INTEGER))
            FROM unnest(schedules) AS schedule
          )::INTEGER AS venue_capacity,
          coalesce((
            SELECT sum(coalesce(reservation.unnest.enroll, 0))
            FROM unnest(reservations) AS reservation
          ), 0)::INTEGER AS reservation_enroll,
          coalesce((
            SELECT sum(coalesce(reservation.unnest.quota, 0))
            FROM unnest(reservations) AS reservation
          ), 0)::INTEGER AS reservation_quota
        FROM selected
      ), base AS (
        SELECT trajectory_id, min(term) AS term, min(course) AS course,
          min(section) AS section, min(association) AS association,
          min(class_type) AS class_type, min(add_drop_end) AS add_drop_end
        FROM changed
        GROUP BY trajectory_id
      ), features AS (
        SELECT b.*, epoch_ms(a.observed_at) AS activation_at,
          af.capacity AS activation_capacity,
          af.enroll AS activation_enroll,
          af.instructor AS activation_instructor,
          af.meeting AS activation_meeting,
          af.venue_capacity AS activation_venue_capacity,
          af.reservation_enroll AS activation_reservation_enroll,
          af.reservation_quota AS activation_reservation_quota,
          df.capacity AS deadline_capacity,
          df.enroll AS deadline_enroll,
          df.instructor AS deadline_instructor,
          df.meeting AS deadline_meeting,
          df.venue_capacity AS deadline_venue_capacity,
          df.reservation_enroll AS deadline_reservation_enroll,
          df.reservation_quota AS deadline_reservation_quota,
          d.wait AS deadline_wait
        FROM base b
        LEFT JOIN activation a USING (trajectory_id)
        LEFT JOIN feature_values af
          ON af.trajectory_id = a.trajectory_id
          AND af.event_no = a.event_no
        LEFT JOIN deadline d USING (trajectory_id)
        LEFT JOIN feature_values df
          ON df.trajectory_id = d.trajectory_id
          AND df.event_no = d.event_no
      ), hours AS (
        SELECT * FROM (VALUES (12), (24), (48)) AS values(hours)
      ), positions AS (
        SELECT * FROM (VALUES (5), (25), (50)) AS values(queue_position)
      ), starts AS (
        SELECT f.trajectory_id, h.hours, e.event_no AS start_event_no,
          e.wait AS start_wait
        FROM features f
        CROSS JOIN hours h
        JOIN changed e ON e.trajectory_id = f.trajectory_id
          AND e.observed_at <= f.add_drop_end
          AND epoch_ms(e.observed_at) <= f.activation_at + h.hours * 3600000
        WHERE f.activation_at IS NOT NULL
        QUALIFY row_number() OVER (
          PARTITION BY f.trajectory_id, h.hours ORDER BY e.event_no DESC
        ) = 1
      ), future AS (
        SELECT s.trajectory_id, s.hours, s.start_wait,
          e.event_no, e.wait,
          lag(e.wait) OVER (
            PARTITION BY s.trajectory_id, s.hours ORDER BY e.event_no
          ) AS previous_wait
        FROM starts s
        JOIN changed e ON e.trajectory_id = s.trajectory_id
          AND e.event_no >= s.start_event_no
          AND e.observed_at <= (
            SELECT add_drop_end FROM features f
            WHERE f.trajectory_id = s.trajectory_id
          )
      ), movements AS (
        SELECT trajectory_id, hours, start_wait,
          start_wait - min(wait) AS net,
          coalesce(sum(CASE
            WHEN previous_wait IS NULL THEN 0
            ELSE greatest(previous_wait - wait, 0)
          END), 0) AS gross
        FROM future
        GROUP BY trajectory_id, hours, start_wait
      ), outcomes AS (
        SELECT m.trajectory_id, h.hours, p.queue_position,
          m.start_wait AS start, m.net, m.gross,
          m.net >= p.queue_position AS success
        FROM movements m
        CROSS JOIN positions p
        JOIN hours h ON h.hours = m.hours
        WHERE m.start_wait >= p.queue_position
      ), event_json AS (
        SELECT trajectory_id, to_json(list(struct_pack(
          at := epoch_ms(observed_at), wait := wait
        ) ORDER BY event_no)) AS events_json
        FROM changed
        GROUP BY trajectory_id
      ), outcome_json AS (
        SELECT trajectory_id, to_json(list(struct_pack(
          hours := hours, queue_position := queue_position, start := start,
          net := net, gross := gross, success := success
        ) ORDER BY hours, queue_position)) AS outcomes_json
        FROM outcomes
        GROUP BY trajectory_id
      )
      SELECT f.trajectory_id, f.term, f.course, f.section, f.association,
        f.class_type, f.activation_at,
        f.activation_capacity, f.activation_enroll,
        f.activation_instructor, f.activation_meeting,
        f.activation_venue_capacity, f.activation_reservation_enroll,
        f.activation_reservation_quota, f.deadline_capacity,
        f.deadline_enroll, f.deadline_instructor, f.deadline_meeting,
        f.deadline_venue_capacity, f.deadline_reservation_enroll,
        f.deadline_reservation_quota, f.deadline_wait,
        e.events_json, coalesce(o.outcomes_json, '[]') AS outcomes_json
      FROM features f
      JOIN event_json e USING (trajectory_id)
      LEFT JOIN outcome_json o USING (trajectory_id)
      ORDER BY f.term, f.course, f.section, f.trajectory_id
    `);
    const rows = reader.getRowObjectsJS() as Array<Record<string, unknown>>;
    return rows.map((value) => {
      const activationAtValue =
        value.activation_at === null || value.activation_at === undefined
          ? undefined
          : Number(value.activation_at);
      const activationCapacity =
        value.activation_capacity === null ||
        value.activation_capacity === undefined
          ? undefined
          : Number(value.activation_capacity);
      const deadlineCapacity =
        value.deadline_capacity === null ||
        value.deadline_capacity === undefined
          ? undefined
          : Number(value.deadline_capacity);
      const features = (prefix: "activation" | "deadline") => {
        const capacity =
          prefix === "activation" ? activationCapacity : deadlineCapacity;
        if (capacity === undefined) return;
        const valueFor = (name: string) => value[`${prefix}_${name}`];
        const result: Features = {
          capacity,
          enroll: Number(valueFor("enroll")),
          instructor: String(valueFor("instructor")),
          meeting: String(valueFor("meeting")),
          reservationEnroll: Number(valueFor("reservation_enroll")),
          reservationQuota: Number(valueFor("reservation_quota")),
        };
        const venueCapacity = valueFor("venue_capacity");
        if (venueCapacity !== null && venueCapacity !== undefined)
          result.venueCapacity = Number(venueCapacity);
        return result;
      };
      const outcomes = JSON.parse(String(value.outcomes_json)) as Array<{
        gross: number;
        hours: number;
        net: number;
        queue_position: number;
        start: number;
        success: boolean;
      }>;
      return {
        activationAt: activationAtValue,
        activationFeatures: features("activation"),
        association:
          value.association === null || value.association === undefined
            ? undefined
            : Number(value.association),
        course: String(value.course),
        deadlineFeatures: features("deadline"),
        deadlineWait:
          value.deadline_wait === null || value.deadline_wait === undefined
            ? undefined
            : Number(value.deadline_wait),
        events: JSON.parse(String(value.events_json)) as Event[],
        outcomes: new Map(
          outcomes.map((item) => [
            `${item.queue_position}:${item.hours}`,
            {
              ...item,
              hours: Number(item.hours),
              position: Number(item.queue_position),
            },
          ]),
        ),
        section: String(value.section),
        term: String(value.term) as TermCode,
        type: String(value.class_type),
      } satisfies Trajectory;
    });
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function capacityBucket(value?: Features): string {
  if (!value?.venueCapacity) return "unknown";
  const venueUse = value.capacity / value.venueCapacity;
  const occupancy = value.capacity ? value.enroll / value.capacity : 0;
  const reservation = value.reservationQuota
    ? value.reservationEnroll / value.reservationQuota < 0.8
      ? "reserved-open"
      : "reserved-full"
    : "unreserved";
  return `${venueUse < 0.65 ? "low" : venueUse < 0.9 ? "medium" : "full"}:${occupancy < 0.8 ? "open" : "occupied"}:${reservation}`;
}

const tuningPositions = [5, 25, 50] as const;
const tuningHours = [12, 24, 48] as const;
const priorWeights = [0.5, 1, 2, 4, 8, 16, 32] as const;
const modelNames = [
  "global",
  "baseline",
  "capacity",
  "instructor",
  "meeting",
  "all",
] as const;
type Stats = { count: number; successes: number };
type StatsMap = Map<string, Map<string, Stats>>;
type CompactCase = {
  actual: boolean;
  localCount: number;
  localSuccesses: number;
  priorCount: number;
  priorSuccesses: number;
};
type SingleIndex = {
  localAny: Map<ModelName, StatsMap>;
  localSeasonal: Map<ModelName, StatsMap>;
  priorFallback: Map<string, Stats>;
  priorTiming: StatsMap;
};
type SingleCells = Record<ModelName, CompactCase[][]>;

const termTimes = Object.fromEntries(
  Object.entries(terms).map(([term, value]) => [
    term,
    {
      addDropEnd: Date.parse(value.addDropEnd),
      enrollmentStart: Date.parse(value.enrollmentStart),
      season: value.season,
    },
  ]),
) as Record<
  TermCode,
  {
    addDropEnd: number;
    enrollmentStart: number;
    season: string;
  }
>;

function emptyStats(): Stats {
  return { count: 0, successes: 0 };
}

function addStats(
  map: StatsMap,
  base: string,
  timing: [number, number],
  success: boolean,
): void {
  const timingKey = `${timing[0]}:${timing[1]}`;
  const values = map.get(base) ?? new Map<string, Stats>();
  const stats = values.get(timingKey) ?? emptyStats();
  stats.count += 1;
  if (success) stats.successes += 1;
  values.set(timingKey, stats);
  map.set(base, values);
}

function sumNearby(
  map: StatsMap,
  base: string,
  timing: [number, number],
): Stats {
  const values = map.get(base);
  if (!values) return emptyStats();
  const result = emptyStats();
  for (let normal = timing[0] - 1; normal <= timing[0] + 1; normal += 1)
    for (
      let deadline = timing[1] - 1;
      deadline <= timing[1] + 1;
      deadline += 1
    ) {
      const stats = values.get(`${normal}:${deadline}`);
      if (!stats) continue;
      result.count += stats.count;
      result.successes += stats.successes;
    }
  return result;
}

function timingKey(
  trajectory: Trajectory,
  hours: number,
): [number, number] | undefined {
  if (trajectory.activationAt === undefined) return;
  const time = termTimes[trajectory.term];
  const observed = trajectory.activationAt + hours * 3_600_000;
  return [
    Math.floor((observed - time.enrollmentStart) / 86_400_000 / 2),
    Math.floor((time.addDropEnd - observed) / 86_400_000 / 3),
  ];
}

function modelBase(
  trajectory: Trajectory,
  model: ModelName,
): string | undefined {
  if (model === "global") return "global";
  let base = `${trajectory.course}\0${trajectory.type}`;
  const features = trajectory.activationFeatures;
  if (model === "capacity" || model === "all")
    base += `\0${capacityBucket(features)}`;
  if (model === "instructor" || model === "all") {
    if (!features?.instructor) return;
    base += `\0${features.instructor}`;
  }
  if (model === "meeting" || model === "all") {
    if (!features?.meeting) return;
    base += `\0${features.meeting}`;
  }
  return base;
}

// Only compact trajectory rows and aggregate counts cross into JavaScript.
function buildSingleIndex(
  samples: Array<{ trajectory: Trajectory; result: PrecomputedOutcome }>,
): SingleIndex {
  const index: SingleIndex = {
    localAny: new Map(),
    localSeasonal: new Map(),
    priorFallback: new Map(),
    priorTiming: new Map(),
  };
  for (const model of modelNames) {
    index.localAny.set(model, new Map());
    index.localSeasonal.set(model, new Map());
  }
  for (const { trajectory, result } of samples) {
    const timing = timingKey(trajectory, result.hours);
    if (!timing) continue;
    const prior = index.priorFallback.get(trajectory.type) ?? emptyStats();
    prior.count += 1;
    if (result.success) prior.successes += 1;
    index.priorFallback.set(trajectory.type, prior);
    addStats(index.priorTiming, trajectory.type, timing, result.success);
    for (const model of modelNames) {
      const base = modelBase(trajectory, model);
      if (!base) continue;
      addStats(
        index.localAny.get(model) as StatsMap,
        base,
        timing,
        result.success,
      );
      addStats(
        index.localSeasonal.get(model) as StatsMap,
        `${termTimes[trajectory.term].season}\0${base}`,
        timing,
        result.success,
      );
    }
  }
  return index;
}

function dynamicOutcome(
  trajectory: Trajectory,
  position: number,
  hours: number,
): PrecomputedOutcome | undefined {
  const activation = trajectory.activationAt;
  if (activation === undefined || !Number.isFinite(hours)) return;
  const cutoff = activation + hours * 3_600_000;
  const deadline = termTimes[trajectory.term].addDropEnd;
  let startIndex = -1;
  for (let index = 0; index < trajectory.events.length; index += 1) {
    const event = trajectory.events[index];
    if (!event || event.at < activation || event.at > deadline) continue;
    if (event.at > cutoff) break;
    startIndex = index;
  }
  const start = trajectory.events[startIndex]?.wait;
  if (startIndex < 0 || start === undefined || start < position) return;
  let minimum = start;
  let gross = 0;
  for (
    let index = startIndex + 1;
    index < trajectory.events.length;
    index += 1
  ) {
    const event = trajectory.events[index];
    const previous = trajectory.events[index - 1];
    if (!event || event.at > deadline) break;
    minimum = Math.min(minimum, event.wait);
    if (previous) gross += Math.max(previous.wait - event.wait, 0);
  }
  const net = start - minimum;
  return {
    gross,
    hours,
    net,
    position,
    start,
    success: net >= position,
  };
}

function singleMatches(
  sample: { trajectory: Trajectory; result: PrecomputedOutcome },
  candidate: Trajectory,
  hours: number,
  model: ModelName,
  seasonal: boolean,
): boolean {
  const sampleTiming = timingKey(sample.trajectory, hours);
  const candidateTiming = timingKey(candidate, hours);
  const sampleBase = modelBase(sample.trajectory, model);
  const candidateBase = modelBase(candidate, model);
  return Boolean(
    sampleTiming &&
      candidateTiming &&
      Math.abs(sampleTiming[0] - candidateTiming[0]) <= 1 &&
      Math.abs(sampleTiming[1] - candidateTiming[1]) <= 1 &&
      sampleBase !== undefined &&
      sampleBase === candidateBase &&
      (!seasonal ||
        termTimes[sample.trajectory.term].season ===
          termTimes[candidate.term].season),
  );
}

function targetPredictionFast(
  training: Trajectory[],
  candidate: Trajectory,
  position: number,
  hours: number,
  model: ModelName,
  priorWeight: number,
) {
  const samples = training.flatMap((trajectory) => {
    const result = dynamicOutcome(trajectory, position, hours);
    return result ? [{ trajectory, result }] : [];
  });
  const result = dynamicOutcome(candidate, position, hours);
  if (!result) return;
  const evidenceResult = singleEvidence(
    buildSingleIndex(samples),
    candidate,
    result,
    model,
  );
  if (!evidenceResult) return;
  const prior = evidenceResult.priorSuccesses / evidenceResult.priorCount;
  const seasonalLocal = samples.filter((sample) =>
    singleMatches(sample, candidate, hours, model, true),
  );
  const local = seasonalLocal.length
    ? seasonalLocal
    : samples.filter((sample) =>
        singleMatches(sample, candidate, hours, model, false),
      );
  return {
    estimate:
      (evidenceResult.localSuccesses + priorWeight * prior) /
      (evidenceResult.localCount + priorWeight),
    local: local.map(({ result: value }) => value),
    prior,
    priorSamples: evidenceResult.priorCount,
  };
}

function singleEvidence(
  index: SingleIndex,
  candidate: Trajectory,
  result: PrecomputedOutcome,
  model: ModelName,
): CompactCase | undefined {
  const timing = timingKey(candidate, result.hours);
  if (!timing) return;
  const timedPrior = sumNearby(index.priorTiming, candidate.type, timing);
  const fallbackPrior = index.priorFallback.get(candidate.type) ?? emptyStats();
  const prior = timedPrior.count ? timedPrior : fallbackPrior;
  if (!prior.count) return;
  const base = modelBase(candidate, model);
  const seasonal = base
    ? sumNearby(
        index.localSeasonal.get(model) as StatsMap,
        `${termTimes[candidate.term].season}\0${base}`,
        timing,
      )
    : emptyStats();
  const local = seasonal.count
    ? seasonal
    : base
      ? sumNearby(index.localAny.get(model) as StatsMap, base, timing)
      : emptyStats();
  return {
    actual: result.success,
    localCount: local.count,
    localSuccesses: local.successes,
    priorCount: prior.count,
    priorSuccesses: prior.successes,
  };
}

let singleCellsCache: SingleCells | undefined;
function singleCells(trajectories: Trajectory[]): SingleCells {
  if (singleCellsCache) return singleCellsCache;
  const cells = Object.fromEntries(
    modelNames.map((model) => [model, [] as CompactCase[][]]),
  ) as SingleCells;
  for (const position of tuningPositions)
    for (const hours of tuningHours) {
      const cellCases = Object.fromEntries(
        modelNames.map((model) => [model, [] as CompactCase[]]),
      ) as Record<ModelName, CompactCase[]>;
      for (const heldOutTerm of ["2510", "2530"] as HistoricalTerm[]) {
        const training = trajectories.filter(
          (sample) =>
            termTimes[sample.term].addDropEnd <
            termTimes[heldOutTerm].addDropEnd,
        );
        const samples = training.flatMap((trajectory) => {
          const result = trajectory.outcomes?.get(`${position}:${hours}`);
          return result ? [{ trajectory, result }] : [];
        });
        const index = buildSingleIndex(samples);
        for (const candidate of trajectories) {
          if (candidate.term !== heldOutTerm) continue;
          const result = candidate.outcomes?.get(`${position}:${hours}`);
          if (!result) continue;
          for (const model of modelNames) {
            const item = singleEvidence(index, candidate, result, model);
            if (item) cellCases[model].push(item);
          }
        }
      }
      for (const model of modelNames) cells[model].push(cellCases[model]);
    }
  singleCellsCache = cells;
  return cells;
}

function score(
  cells: CompactCase[][],
  priorWeight: number,
): { brier: number; exact: number; total: number } {
  const populated = cells.filter((items) => items.length > 0);
  const briers = populated.map(
    (cases) =>
      cases.reduce((sum, item) => {
        const prior = item.priorSuccesses / item.priorCount;
        const estimate =
          (item.localSuccesses + priorWeight * prior) /
          (item.localCount + priorWeight);
        return sum + (estimate - Number(item.actual)) ** 2;
      }, 0) / cases.length,
  );
  return {
    brier: briers.reduce((sum, value) => sum + value, 0) / briers.length,
    exact: cells.flat().filter((item) => item.localCount > 0).length,
    total: cells.flat().length,
  };
}

function tune(
  trajectories: Trajectory[],
  model: ModelName,
): {
  brier: number;
  exact: number;
  scores: Array<{ brier: number; weight: number }>;
  total: number;
  weight: number;
} {
  const cells = singleCells(trajectories)[model];
  const results = priorWeights.map((weight) => ({
    ...score(cells, weight),
    weight,
  }));
  const best = [...results].sort((a, b) => a.brier - b.brier)[0];
  return {
    ...best,
    scores: results.map(({ brier, weight }) => ({ brier, weight })),
  };
}

type Bundle = ReturnType<typeof bundleTrajectories>[number];
type JointSample = {
  bundle: Bundle;
  outcomes: PrecomputedOutcome[];
  success: boolean;
  timing: Array<[number, number]>;
};
type JointIndex = {
  localAny: Map<ModelName, StatsMap>;
  localSeasonal: Map<ModelName, StatsMap>;
  priorFallback: Map<string, Stats>;
  priorTiming: StatsMap;
};

function jointTimingKey(timing: Array<[number, number]>): string {
  return timing.map(([normal, deadline]) => `${normal}:${deadline}`).join("/");
}

function nearbyJointTimingKeys(timing: Array<[number, number]>): string[] {
  let keys = [""];
  for (const [normal, deadline] of timing) {
    keys = keys.flatMap((prefix) =>
      Array.from({ length: 9 }, (_, index) => {
        const normalOffset = (index % 3) - 1;
        const deadlineOffset = Math.floor(index / 3) - 1;
        return `${prefix}${prefix ? "/" : ""}${normal + normalOffset}:${deadline + deadlineOffset}`;
      }),
    );
  }
  return keys;
}

function sumJointNearby(
  map: StatsMap,
  base: string,
  timing: Array<[number, number]>,
): Stats {
  const values = map.get(base);
  if (!values) return emptyStats();
  const result = emptyStats();
  for (const key of nearbyJointTimingKeys(timing)) {
    const stats = values.get(key);
    if (!stats) continue;
    result.count += stats.count;
    result.successes += stats.successes;
  }
  return result;
}

function jointBase(bundle: Bundle, model: ModelName): string | undefined {
  let base = bundle.pattern;
  if (model !== "global") base += `\\0${bundle.course}`;
  for (const component of bundle.components) {
    const trajectory = component.trajectory as Trajectory;
    const features = trajectory.activationFeatures;
    if (model === "capacity" || model === "all")
      base += `\\0${capacityBucket(features)}`;
    if (model === "instructor" || model === "all") {
      if (!features?.instructor) return;
      base += `\\0${features.instructor}`;
    }
    if (model === "meeting" || model === "all") {
      if (!features?.meeting) return;
      base += `\\0${features.meeting}`;
    }
  }
  return base;
}

function jointSample(
  bundle: Bundle,
  position: number,
  hours: number,
): JointSample | undefined {
  const outcomes: PrecomputedOutcome[] = [];
  const timing: Array<[number, number]> = [];
  for (const { trajectory: value } of bundle.components) {
    const trajectory = value as Trajectory;
    const result = trajectory.outcomes?.get(`${position}:${hours}`);
    const componentTiming = timingKey(trajectory, hours);
    if (!result || !componentTiming) return;
    outcomes.push(result);
    timing.push(componentTiming);
  }
  if (!outcomes.length) return;
  return {
    bundle,
    outcomes,
    success: outcomes.every((result) => result.success),
    timing,
  };
}

function buildJointIndex(samples: JointSample[]): JointIndex {
  const index: JointIndex = {
    localAny: new Map(),
    localSeasonal: new Map(),
    priorFallback: new Map(),
    priorTiming: new Map(),
  };
  for (const model of modelNames) {
    index.localAny.set(model, new Map());
    index.localSeasonal.set(model, new Map());
  }
  for (const sample of samples) {
    const { bundle } = sample;
    const prior = index.priorFallback.get(bundle.pattern) ?? emptyStats();
    prior.count += 1;
    if (sample.success) prior.successes += 1;
    index.priorFallback.set(bundle.pattern, prior);
    const timingKeyValue = jointTimingKey(sample.timing);
    const addJointStats = (map: StatsMap, base: string) => {
      const values = map.get(base) ?? new Map<string, Stats>();
      const stats = values.get(timingKeyValue) ?? emptyStats();
      stats.count += 1;
      if (sample.success) stats.successes += 1;
      values.set(timingKeyValue, stats);
      map.set(base, values);
    };
    // Joint timing vectors need one key, unlike single-Class timing pairs.
    const priorValues =
      index.priorTiming.get(bundle.pattern) ?? new Map<string, Stats>();
    const priorStats = priorValues.get(timingKeyValue) ?? emptyStats();
    priorStats.count += 1;
    if (sample.success) priorStats.successes += 1;
    priorValues.set(timingKeyValue, priorStats);
    index.priorTiming.set(bundle.pattern, priorValues);
    for (const model of modelNames) {
      const base = jointBase(bundle, model);
      if (!base) continue;
      addJointStats(index.localAny.get(model) as StatsMap, base);
      addJointStats(
        index.localSeasonal.get(model) as StatsMap,
        `${bundle.season}\\0${base}`,
      );
    }
  }
  return index;
}

function jointEvidence(
  index: JointIndex,
  candidate: JointSample,
  model: ModelName,
): CompactCase | undefined {
  const { bundle } = candidate;
  const timedPrior = sumJointNearby(
    index.priorTiming,
    bundle.pattern,
    candidate.timing,
  );
  const fallbackPrior = index.priorFallback.get(bundle.pattern) ?? emptyStats();
  const prior = timedPrior.count ? timedPrior : fallbackPrior;
  if (!prior.count) return;
  const base = jointBase(bundle, model);
  const seasonal = base
    ? sumJointNearby(
        index.localSeasonal.get(model) as StatsMap,
        `${bundle.season}\\0${base}`,
        candidate.timing,
      )
    : emptyStats();
  const local = seasonal.count
    ? seasonal
    : base
      ? sumJointNearby(
          index.localAny.get(model) as StatsMap,
          base,
          candidate.timing,
        )
      : emptyStats();
  return {
    actual: candidate.success,
    localCount: local.count,
    localSuccesses: local.successes,
    priorCount: prior.count,
    priorSuccesses: prior.successes,
  };
}

function jointCells(
  bundles: Bundle[],
  heldOutTerms: readonly string[],
): Record<ModelName, CompactCase[][]> {
  const cells = Object.fromEntries(
    modelNames.map((model) => [model, [] as CompactCase[][]]),
  ) as Record<ModelName, CompactCase[][]>;
  for (const position of tuningPositions)
    for (const hours of tuningHours) {
      const cellCases = Object.fromEntries(
        modelNames.map((model) => [model, [] as CompactCase[]]),
      ) as Record<ModelName, CompactCase[]>;
      for (const heldOutTerm of heldOutTerms) {
        const training = bundles.filter(
          (bundle) =>
            termTimes[bundle.term as TermCode].addDropEnd <
            termTimes[heldOutTerm as TermCode].addDropEnd,
        );
        const index = buildJointIndex(
          training.flatMap((bundle) => {
            const sample = jointSample(bundle, position, hours);
            return sample ? [sample] : [];
          }),
        );
        for (const bundle of bundles) {
          if (bundle.term !== heldOutTerm) continue;
          const sample = jointSample(bundle, position, hours);
          if (!sample) continue;
          for (const model of modelNames) {
            const item = jointEvidence(index, sample, model);
            if (item) cellCases[model].push(item);
          }
        }
      }
      for (const model of modelNames) cells[model].push(cellCases[model]);
    }
  return cells;
}

const jointCellsCache = new Map<string, Record<ModelName, CompactCase[][]>>();
function tuneJointFast(
  bundles: Bundle[],
  model: ModelName,
  heldOutTerms: readonly string[] = ["2510", "2530"],
) {
  const cacheKey = heldOutTerms.join(",");
  const cells =
    jointCellsCache.get(cacheKey) ??
    (() => {
      const value = jointCells(bundles, heldOutTerms);
      jointCellsCache.set(cacheKey, value);
      return value;
    })();
  const scores = priorWeights.map((weight) => ({
    ...score(cells[model], weight),
    weight,
  }));
  const best = [...scores].sort(
    (left, right) => left.brier - right.brier || left.weight - right.weight,
  )[0];
  if (!best) throw new Error("No joint prior weights configured");
  return { ...best, scores };
}

function jointPredictionFast(
  training: Bundle[],
  candidate: Bundle,
  position: number,
  hours: number,
  model: ModelName,
  priorWeight: number,
) {
  const sample = jointSample(candidate, position, hours);
  if (!sample) return;
  const index = buildJointIndex(
    training.flatMap((bundle) => {
      const value = jointSample(bundle, position, hours);
      return value ? [value] : [];
    }),
  );
  const result = jointEvidence(index, sample, model);
  if (!result) return;
  const prior = result.priorSuccesses / result.priorCount;
  return {
    estimate:
      (result.localSuccesses + priorWeight * prior) /
      (result.localCount + priorWeight),
    local: Array.from({ length: result.localCount }, () => undefined),
    prior,
    priorSamples: result.priorCount,
    successes: result.localSuccesses,
  };
}

async function currentHuma(): Promise<CurrentClass> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    if (
      scheduleCourses.startsWith("http") ||
      scheduleClasses.startsWith("http")
    )
      await connection.run("INSTALL httpfs; LOAD httpfs;");
    const reader = await connection.runAndReadAll(`
      WITH course AS (
        SELECT term_code, id
        FROM read_parquet('${sqlPath(scheduleCourses)}')
        WHERE term_code = '2610' AND prefix = 'HUMA' AND number = '1710'
        QUALIFY row_number() OVER (PARTITION BY term_code, id ORDER BY "timestamp" DESC) = 1
      ), history AS (
        SELECT c.*
        FROM read_parquet('${sqlPath(scheduleClasses)}') c
        JOIN course o ON o.term_code = c.term_code AND o.id = c.course_id
        WHERE c.section = 'L1'
      )
      SELECT capacity::INTEGER AS capacity, enroll::INTEGER AS enroll,
        greatest(wait, 0)::INTEGER AS wait, epoch_ms("timestamp") AS observed_at,
        (SELECT min(epoch_ms("timestamp")) FROM history
          WHERE wait > 0
            AND "timestamp" >= TIMESTAMPTZ '${terms["2610"].enrollmentStart}') AS activation,
        to_json(reservations) AS reservations, to_json(schedules) AS schedules
      FROM history
      ORDER BY "timestamp" DESC
      LIMIT 1
    `);
    const [row] = reader.getRowObjectsJS() as Array<Record<string, unknown>>;
    if (!row) throw new Error("Current HUMA 1710 L1 was not found");
    const reservations = JSON.parse(String(row.reservations)) as Array<{
      enroll: number;
      name: string;
      quota: number;
    }>;
    const schedules = JSON.parse(String(row.schedules)) as Array<{
      instructors: string[];
      time_from: string;
      venue_name: string;
      weekday: string;
    }>;
    const venueCapacity = physicalVenueCapacity(
      schedules.map((meeting) => meeting.venue_name),
    );
    const instructors = schedules
      .flatMap((meeting) => meeting.instructors)
      .map((name) => name.trim())
      .filter((name) => name && name.toLowerCase() !== "tba")
      .sort();
    return {
      activation: Number(row.activation),
      capacity: Number(row.capacity),
      enroll: Number(row.enroll),
      instructor: instructors[0] ?? "TBA",
      meeting: schedules
        .map((meeting) => `${meeting.weekday}@${meeting.time_from.slice(0, 2)}`)
        .sort()
        .join("|"),
      reservationEnroll: reservations.reduce(
        (sum, reservation) => sum + reservation.enroll,
        0,
      ),
      reservationQuota: reservations.reduce(
        (sum, reservation) => sum + reservation.quota,
        0,
      ),
      timestamp: Number(row.observed_at),
      venue: schedules[0]?.venue_name ?? "Unknown",
      ...(venueCapacity === undefined ? {} : { venueCapacity }),
      wait: Number(row.wait),
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function interval(
  estimate: number,
  sampleSize: number,
  priorWeight: number,
): { high: number; low: number; margin: number; width: number } {
  const effective = sampleSize + priorWeight;
  const margin =
    1.645 * Math.sqrt((estimate * (1 - estimate)) / (effective + 1));
  const low = Math.max(0, estimate - margin);
  const high = Math.min(1, estimate + margin);
  return { high, low, margin, width: high - low };
}

function selfCheck(): void {
  const start = Date.parse(terms["2510"].enrollmentStart) + 3_600_000;
  const sample: Trajectory = {
    activationAt: start,
    term: "2510",
    course: "TEST1000",
    section: "L1",
    type: "LEC",
    events: [
      { at: start - 3_600_000, wait: 0 },
      { at: start, wait: 30 },
      { at: start + 3_600_000, wait: 20 },
      { at: start + 7_200_000, wait: 25 },
      { at: start + 10_800_000, wait: 10 },
    ],
  };
  const result = dynamicOutcome(sample, 20, 0);
  if (result?.net !== 20 || result.gross !== 25 || !result.success)
    throw new Error("movement self-check failed");
}

function jointSelfCheck(): void {
  const make = (
    section: string,
    type: string,
    waits: number[],
  ): WaitlistTrajectory => ({
    association: 1,
    course: "TEST1000",
    events: waits.map((wait, index) => ({
      at: Date.parse(terms["2410"].enrollmentStart) + index * 3_600_000,
      wait,
    })),
    section,
    term: "2410",
    type,
  });
  const bundle = bundleTrajectories([
    make("L1", "LEC", [0, 30, 10]),
    make("LA1", "LAB", [0, 12, 2]),
  ])[0];
  const favorable = bundle
    ? jointOutcome(bundle, {
        components: [
          { section: "L1", type: "LEC", position: 20, activationHours: 0 },
          { section: "LA1", type: "LAB", position: 5, activationHours: 0 },
        ],
      })
    : undefined;
  const failed = bundle
    ? jointOutcome(bundle, {
        components: [
          { section: "L1", type: "LEC", position: 20, activationHours: 0 },
          { section: "LA1", type: "LAB", position: 11, activationHours: 0 },
        ],
      })
    : undefined;
  if (!favorable?.success || failed?.success !== false)
    throw new Error("joint movement self-check failed");
}

const startedAt = performance.now();
selfCheck();
jointSelfCheck();
if (process.argv.includes("--self-check")) {
  console.log("Waitlist single-Class and joint self-checks passed");
  process.exit(0);
}
console.error("Extracting historical queue trajectories…");
const trajectories = await extractTrajectories();
if (process.argv.includes("--extract-only")) {
  console.log(`Extracted ${trajectories.length} trajectories`);
  process.exit(0);
}
const current = await currentHuma();
const scheduleRevision = await sourceRevision(unifiedClasses);
const position = 25;
const hoursSinceActivation = Math.max(
  0,
  (current.timestamp - current.activation) / 3_600_000,
);
const modelResults = modelNames.map((model) => ({
  model,
  ...tune(trajectories, model),
}));
const retained = [...modelResults].sort((a, b) => a.brier - b.brier)[0];

const bundles = bundleTrajectories(trajectories as WaitlistTrajectory[]);
const jointModelResults = modelNames.map((model) => ({
  model,
  ...tuneJointFast(
    bundles,
    model,
    validationTerm ? [validationTerm] : undefined,
  ),
}));
const retainedJoint = [...jointModelResults].sort(
  (a, b) =>
    (Number.isNaN(a.brier) ? Number.POSITIVE_INFINITY : a.brier) -
    (Number.isNaN(b.brier) ? Number.POSITIVE_INFINITY : b.brier),
)[0];
if (!retainedJoint) throw new Error("No joint model result was available");
const productionJointModel = "baseline" as const;
const productionPriorWeight = WAITLIST_PRIOR_WEIGHT;
const productionJointWeight = productionPriorWeight;
const jointBundle = bundles.find(
  (bundle) =>
    bundle.components.length >= 2 &&
    jointSample(bundle, 25, 24) !== undefined &&
    (!validationTerm || bundle.term !== validationTerm),
);
const jointTraining = validationTerm
  ? bundles.filter(
      (bundle) =>
        Date.parse(terms[bundle.term as TermCode].addDropEnd) <
        Date.parse(terms[validationTerm as TermCode].addDropEnd),
    )
  : bundles;
const jointPredictionResult = jointBundle
  ? jointPredictionFast(
      jointTraining,
      jointBundle,
      25,
      24,
      productionJointModel,
      productionJointWeight,
    )
  : undefined;
const jointUncertainty = jointPredictionResult
  ? jointInterval(
      jointPredictionResult.estimate,
      jointPredictionResult.local.length,
      productionJointWeight,
    )
  : undefined;

const target: Trajectory = {
  activationAt: current.activation,
  activationFeatures: current,
  course: "HUMA 1710",
  events: [{ at: current.activation, wait: current.wait }],
  section: "L1",
  term: "2610",
  type: "LEC",
};
const targetTraining = trajectories.filter(
  (trajectory) =>
    Date.parse(terms[trajectory.term].addDropEnd) <
    Date.parse(terms["2610"].addDropEnd),
);
const targetPrediction = targetPredictionFast(
  targetTraining,
  target,
  position,
  hoursSinceActivation,
  retained.model,
  productionPriorWeight,
);
if (!targetPrediction) throw new Error("No historical LEC prior was available");
const uncertainty = interval(
  targetPrediction.estimate,
  targetPrediction.local.length,
  productionPriorWeight,
);
const displayedEstimate = Math.round(targetPrediction.estimate * 100);
const displayedLow = Math.round(uncertainty.low * 100);
const displayedHigh = Math.round(uncertainty.high * 100);
const displayedMargin = Math.max(
  displayedEstimate - displayedLow,
  displayedHigh - displayedEstimate,
);
const localSuccesses = targetPrediction.local.filter(
  (result) => result.success,
).length;
const localNet = targetPrediction.local.map((result) => result.net);
const localGross = targetPrediction.local.map((result) => result.gross);

const historicalHuma =
  trajectories.find(
    (trajectory) =>
      trajectory.term === "2510" &&
      trajectory.course === "HUMA 1710" &&
      trajectory.section === "L1" &&
      trajectory.association === undefined,
  ) ??
  trajectories.find(
    (trajectory) =>
      trajectory.term === "2510" &&
      trajectory.course === "HUMA 1710" &&
      trajectory.section === "L1",
  );
const historicalHumaFeatures = historicalHuma?.deadlineFeatures;
const generalCapacity = current.capacity - current.reservationQuota;
const generalEnroll = current.enroll - current.reservationEnroll;
const generalHeadroom = Math.max(generalCapacity - generalEnroll, 0);
const roomExpansion = Math.max(
  (current.venueCapacity ?? current.capacity) - current.capacity,
  0,
);
const historicalExpansion = Math.max(
  (historicalHumaFeatures?.capacity ?? current.capacity) - current.capacity,
  0,
);

const waitlisted = trajectories.filter((trajectory) =>
  trajectory.events.some((event) => event.wait > 0),
);
const reportTermCodes = validationTerm
  ? [...new Set([...historicalTermCodes, validationTerm as TermCode])]
  : historicalTermCodes;
const termRows = reportTermCodes.map((term) => {
  const rows = trajectories.filter((trajectory) => trajectory.term === term);
  return `| ${term} | ${terms[term].season} | ${terms[term].enrollmentStart.slice(0, 10)} | ${terms[term].addDropEnd.slice(0, 10)} | ${rows.length} | ${rows.filter((trajectory) => trajectory.events.some((event) => event.wait > 0)).length} |`;
});
const modelRows = modelResults.map(
  (result) =>
    `| ${result.model} | ${result.weight} | ${result.brier.toFixed(4)} | ${result.exact}/${result.total} | ${result.model === retained.model ? "Retain" : "Reject"} |`,
);
const tuningRows = retained.scores.map(
  (result) => `| ${result.weight} | ${result.brier.toFixed(4)} |`,
);
const jointModelRows = jointModelResults.map(
  (result) =>
    `| ${result.model} | ${result.weight} | ${Number.isNaN(result.brier) ? "n/a" : result.brier.toFixed(4)} | ${result.exact}/${result.total} | ${result.model === productionJointModel ? "Retain" : "Reject"} |`,
);
const jointPattern = jointBundle?.pattern ?? "none";
const jointHeadline =
  jointPredictionResult && jointUncertainty
    ? formatHeadline(
        jointPredictionResult.estimate,
        jointPredictionResult.local.length,
        productionJointWeight,
      )
    : "Unavailable (no two-component Course Offering in the source)";
const jointCalculation = jointPredictionResult
  ? `(${jointPredictionResult.successes} + ${productionJointWeight} × ${jointPredictionResult.prior.toFixed(3)}) ÷ (${jointPredictionResult.local.length} + ${productionJointWeight}) = ${jointPredictionResult.estimate.toFixed(3)}`
  : "not available";

if (validationTerm && !bundles.some((bundle) => bundle.term === validationTerm))
  throw new Error(
    `Validation Term ${validationTerm} has no completed trajectories`,
  );

const report = `# Waitlist queue-evidence ${validationTerm ? `${validationTerm} validation` : "prototype"}

${validationTerm ? `This report evaluates the frozen candidate grid against held-out Term **${validationTerm}**. It does not update production parameters.\n\n` : ""}**Question:** Can aggregate UST Class history provide useful queue evidence without claiming to know an individual student's enrollment outcome?

Generated directly from the unified [Schedule dataset](https://huggingface.co/datasets/ust-archive/schedule) view, with hard-coded dates from confirmed HKUST Registry PDFs.

Schedule source revision: **${scheduleRevision}**. DuckDB pre-computes changed observations, trajectory features, and movement outcomes; JavaScript indexes the resulting counts for the held-out aggregation and formats this report.

## Data coverage

| Term | Season | Normal enrollment start | Add/drop end | Class trajectories | Ever waitlisted |
| --- | --- | --- | --- | ---: | ---: |
${termRows.join("\n")}

- Total trajectories: **${trajectories.length}**
- Ever waitlisted: **${waitlisted.length}**
- Alignment: hours since normal enrollment start, hours since Queue Activation, and time until add/drop (nearby timing buckets are pooled); positive waits before normal enrollment are baseline occupancy
- Enrollment before the official start is treated as baseline occupancy, not Queue Activation

## Time-based model challenge

Every 2025–26 outcome is predicted only from earlier Terms. Tuning covers queue positions ${tuningPositions.join(", ")} at ${tuningHours.join(", ")} hours after Queue Activation. Each position/time cell contributes equally. Prior weight is selected from ${priorWeights.join(", ")} by mean held-out Brier score; lower is better.

| Candidate matching | Prior weight | Brier | Local-match coverage | Decision |
| --- | ---: | ---: | ---: | --- |
${modelRows.join("\n")}

The retained candidate is **${retained.model}**. Global uses only the timing-aligned same-type prior; baseline adds Course/type matching. Capacity includes quota-to-venue utilization and the presence of reservations. Instructor and meeting time are retained only if their held-out score wins; otherwise they remain details, not predictors.

Prior-strength tuning for the retained candidate:

| History-equivalent weight | Mean Brier |
| ---: | ---: |
${tuningRows.join("\n")}

This tuning is provisional: Fall 2026 remains incomplete and is reserved as the next untouched evaluation Term. The single-Class diagnostic grid may select a different weight; the shared production prior remains frozen at **${productionPriorWeight}**.

## Joint Waitlist Plan demonstration

The joint model groups required Classes from one historical Course Offering before calculating outcomes. A favorable sample requires every selected component to clear its own position; marginal component percentages are never multiplied.

- Historical component pattern: **${jointPattern}**
- Joint headline for position 25 on each component: **${jointHeadline}**
- Exact Course-Offering histories: **${jointPredictionResult?.local.length ?? 0}** (${jointPredictionResult?.successes ?? 0} favorable); broader same-pattern histories: **${jointPredictionResult?.priorSamples ?? 0}** at **${jointPredictionResult ? percent(jointPredictionResult.prior) : "n/a"}**
- Separate Queue Activation clocks are used for each component after normal enrollment; Section labels remain identifiers only.
- Joint smoothing calculation: \`${jointCalculation}\`.
- Self-check favorable plan: LEC position 20 + LAB position 5 is favorable. Self-check failed plan: the same LEC position 20 + LAB position 11 is not favorable, because AND semantics require both components to clear.

| Candidate matching | Prior weight | Brier | Local-match coverage | Decision |
| --- | ---: | ---: | ---: | --- |
${jointModelRows.join("\n")}

The production joint candidate is **${productionJointModel}** with frozen prior weight **${productionJointWeight}**. The held-out grid's best baseline weight is **${jointModelResults.find((result) => result.model === productionJointModel)?.weight ?? "n/a"}**; changing production parameters requires a repeatable refresh. Exact smoothing is independent of the single-Class provisional result above.

## Demonstration: HUMA 1710 L1, position 25

Current Schedule snapshot (${new Date(current.timestamp).toISOString()}):

- Queue Activation first observed: **${new Date(current.activation).toISOString()}**
- Time since Queue Activation: **${hoursSinceActivation.toFixed(1)} hours**
- Normal UG enrollment started: **25 August 2026**
- Add/drop ends: **14 September 2026**
- Capacity / enrolled / waitlisted: **${current.capacity} / ${current.enroll} / ${current.wait}**
- Venue: **${current.venue}**, physical capacity **${current.venueCapacity ?? "unknown"}**
- Reserved quota: **${current.reservationEnroll}/${current.reservationQuota} enrolled**

> **Historical queue evidence: ${displayedEstimate}% ±${displayedMargin} pp (${displayedLow}–${displayedHigh}%)**
> Estimated uncertainty width: **${Math.round(uncertainty.width * 100)} percentage points**
> Exact histories: **${targetPrediction.local.length}** (${localSuccesses} favorable); broader LEC histories: **${targetPrediction.priorSamples}** at **${percent(targetPrediction.prior)}**
> Broader-prior influence: **${productionPriorWeight}-history equivalent**; this is not the student's enrollment probability.

### Capacity scenarios

| Scenario | Additional physical/general headroom | Position-25 interpretation |
| --- | ---: | --- |
| No quota expansion | ${generalHeadroom} currently available general seats | Requires drops or reservation release |
| Expand to current venue (${current.venueCapacity ?? "unknown"}) | Up to ${roomExpansion} additional seats | Capacity arithmetic could cover position 25, but expansion is not promised |
| Repeat last year's larger-venue outcome (${historicalHumaFeatures?.capacity ?? "unknown"}) | Up to ${historicalExpansion} additional seats | Historically possible, not a forecast |

Last Fall, the deadline snapshot had capacity **${historicalHumaFeatures?.capacity ?? "unknown"}**, wait **${historicalHuma?.deadlineWait ?? "unknown"}**, venue ceiling **${historicalHumaFeatures?.venueCapacity ?? "unknown"}**, and reservation quota **${historicalHumaFeatures?.reservationQuota ?? "unknown"}**. A venue-driven quota increase materially changed that queue, so capacity paths belong in the evidence rather than being dismissed as noise.

<details>
<summary>How the headline was formed</summary>

- Exact matching: same Course, Class type, and Season; then same Course and Class type.
- Raw exact outcomes: ${targetPrediction.local.length ? `${localSuccesses}/${targetPrediction.local.length}` : "none"} had net queue reduction of at least ${position}.
- Exact net reductions: ${localNet.length ? localNet.join(", ") : "none"}.
- Exact observed exits: ${localGross.length ? localGross.join(", ") : "none"}.
- Sparse exact evidence is shrunk toward the broader same-type rate using production prior weight ${productionPriorWeight}; it is never displayed as an unsupported raw 0% or 100%.
- Headline calculation: \`(${localSuccesses} + ${productionPriorWeight} × ${targetPrediction.prior.toFixed(3)}) ÷ (${targetPrediction.local.length} + ${productionPriorWeight}) = ${targetPrediction.estimate.toFixed(3)}\`.
- The ± value is an estimated uncertainty margin; the explicit range is capped to 0–100% and may therefore be asymmetric.
- Net reduction and observed exits are diagnostics, not mathematical probability bounds.

</details>

## Verdict

The prototype always returns a transparent historical-evidence estimate, but release still requires the retained model to beat simpler alternatives consistently across Terms and queue positions. Reservation eligibility is not requested because the archive cannot calibrate subgroup outcomes. Official dates remain a checked static table until unsupported Terms justify a feed integration.
`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, report);
console.log(output);
console.error(
  `Waitlist report generated in ${((performance.now() - startedAt) / 1000).toFixed(2)}s`,
);

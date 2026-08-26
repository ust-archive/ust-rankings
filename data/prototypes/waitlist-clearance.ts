// PROTOTYPE: tests whether aggregate quota history can support honest queue evidence.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  bundleTrajectories,
  formatHeadline,
  interval as jointInterval,
  jointOutcome,
  prediction as jointPrediction,
  planForBundle,
  tuneJoint,
  type WaitlistModelName,
  type WaitlistTrajectory,
} from "../src/waitlist-evidence.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "data/prototypes/waitlist-clearance-report.md");
const legacyClasses =
  "https://huggingface.co/datasets/ust-archive/schedule/resolve/main/classes_legacy.parquet";

// Confirmed HKUST Registry PDFs. ponytail: static dates until another Term needs support.
const terms = {
  "2410": {
    addDropEnd: "2024-09-14T23:59:00+08:00",
    enrollmentStart: "2024-08-27T00:00:00+08:00",
    season: "Fall",
    source:
      "https://registry.hkust.edu.hk/calendar_dates/dates24-25confirmed.pdf",
  },
  "2430": {
    addDropEnd: "2025-02-15T23:59:00+08:00",
    enrollmentStart: "2025-01-23T00:00:00+08:00",
    season: "Spring",
    source:
      "https://registry.hkust.edu.hk/calendar_dates/dates24-25confirmed.pdf",
  },
  "2510": {
    addDropEnd: "2025-09-13T23:59:00+08:00",
    enrollmentStart: "2025-08-26T00:00:00+08:00",
    season: "Fall",
    source:
      "https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf",
  },
  "2530": {
    addDropEnd: "2026-02-14T23:59:00+08:00",
    enrollmentStart: "2026-01-27T00:00:00+08:00",
    season: "Spring",
    source:
      "https://registry.hkust.edu.hk/calendar_dates/dates25-26confirmed.pdf",
  },
  "2610": {
    addDropEnd: "2026-09-14T23:59:00+08:00",
    enrollmentStart: "2026-08-25T00:00:00+08:00",
    season: "Fall",
    source:
      "https://registry.hkust.edu.hk/calendar_dates/dates26-27confirmed.pdf",
  },
} as const;

type TermCode = keyof typeof terms;
type HistoricalTerm = Exclude<TermCode, "2610">;
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
type Trajectory = {
  activationFeatures?: Features;
  association?: number;
  course: string;
  deadlineFeatures?: Features;
  deadlineWait?: number;
  events: Event[];
  section: string;
  term: TermCode;
  type: string;
};
type Movement = { gross: number; net: number; start: number };
type Outcome = Movement & { success: boolean };
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

function classType(section: string): string {
  if (/^LA/i.test(section)) return "LAB";
  if (/^L/i.test(section)) return "LEC";
  if (/^T/i.test(section)) return "TUT";
  return "IND";
}

function trajectoryKey(term: string, course: string, section: string): string {
  return `${term}|${course}|${section}`;
}

type Reservation = { enroll: number; name: string; quota: number };
type Schedule = {
  fromTime: string | null;
  instructors: string[];
  venue: string;
  weekdays: number[];
};
type LegacyRow = {
  capacity: number;
  course: string;
  enroll: number;
  observedAt: number;
  reservations: Reservation[];
  schedules: Schedule[];
  section: string;
  term: HistoricalTerm;
  wait: number;
};

function rowFeatures(row: LegacyRow): Features {
  const meetings = row.schedules.filter((meeting) => meeting.fromTime);
  const instructors = row.schedules
    .flatMap((meeting) => meeting.instructors)
    .filter((name) => name !== "TBA")
    .sort();
  const venueCapacities = row.schedules
    .map((meeting) => /\((\d+)\)\s*$/.exec(meeting.venue)?.[1])
    .filter(Boolean)
    .map(Number);
  return {
    capacity: row.capacity,
    enroll: row.enroll,
    instructor: instructors[0] ?? "TBA",
    meeting: meetings
      .map(
        (meeting) =>
          `${meeting.weekdays.join(",")}@${meeting.fromTime?.slice(0, 2)}`,
      )
      .sort()
      .join("|"),
    reservationEnroll: row.reservations.reduce(
      (sum, reservation) => sum + reservation.enroll,
      0,
    ),
    reservationQuota: row.reservations.reduce(
      (sum, reservation) => sum + reservation.quota,
      0,
    ),
    venueCapacity: venueCapacities.length
      ? Math.max(...venueCapacities)
      : undefined,
  };
}

async function extractTrajectories(): Promise<Trajectory[]> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(`
      SELECT term_code AS term, course_code AS course, section,
        capacity::INTEGER AS capacity, enroll::INTEGER AS enroll,
        wait::INTEGER AS wait, epoch_ms("timestamp") AS observed_at,
        to_json(reservations) AS reservations, to_json(schedules) AS schedules
      FROM read_parquet('${legacyClasses}')
      WHERE term_code IN ('2410', '2430', '2510', '2530')
      ORDER BY source_order
    `);
    const rows = reader.getRowObjectsJS() as Array<Record<string, unknown>>;
    const trajectories = new Map<string, Trajectory>();
    for (const value of rows) {
      const schedules = JSON.parse(String(value.schedules)) as Array<{
        fromTime: string | null;
        instructors: string[];
        time_from: string | null;
        venue_name: string;
        weekdays: number[];
      }>;
      const row: LegacyRow = {
        capacity: Number(value.capacity),
        course: String(value.course),
        enroll: Number(value.enroll),
        observedAt: Number(value.observed_at),
        reservations: JSON.parse(String(value.reservations)),
        schedules: schedules.map((meeting) => ({
          fromTime: meeting.time_from ?? meeting.fromTime,
          instructors: meeting.instructors,
          venue: meeting.venue_name,
          weekdays: meeting.weekdays,
        })),
        section: String(value.section),
        term: String(value.term) as HistoricalTerm,
        wait: Number(value.wait),
      };
      const id = trajectoryKey(row.term, row.course, row.section);
      const trajectory = trajectories.get(id) ?? {
        course: row.course,
        events: [],
        section: row.section,
        term: row.term,
        type: classType(row.section),
      };
      trajectory.events.push({ at: row.observedAt, wait: row.wait });
      if (row.wait > 0 && !trajectory.activationFeatures)
        trajectory.activationFeatures = rowFeatures(row);
      if (row.observedAt <= Date.parse(terms[row.term].addDropEnd)) {
        trajectory.deadlineFeatures = rowFeatures(row);
        trajectory.deadlineWait = row.wait;
      }
      trajectories.set(id, trajectory);
    }
    return [...trajectories.values()].map((trajectory) => ({
      ...trajectory,
      events: trajectory.events.filter(
        (event, index, events) =>
          index === 0 || event.wait !== events[index - 1].wait,
      ),
    }));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function movement(
  trajectory: Trajectory,
  hoursSinceActivation: number,
): Movement | undefined {
  const activationIndex = trajectory.events.findIndex(
    (event) => event.wait > 0,
  );
  if (activationIndex < 0) return;
  const deadline = Date.parse(terms[trajectory.term].addDropEnd);
  const cutoff =
    trajectory.events[activationIndex].at + hoursSinceActivation * 3_600_000;
  const events = trajectory.events.filter((event) => event.at <= deadline);
  const startIndex = events.findLastIndex((event) => event.at <= cutoff);
  if (startIndex < activationIndex) return;

  const future = events.slice(startIndex);
  const start = future[0].wait;
  return {
    start,
    net: start - Math.min(...future.map((event) => event.wait)),
    gross: future
      .slice(1)
      .reduce(
        (sum, event, index) =>
          sum + Math.max(future[index].wait - event.wait, 0),
        0,
      ),
  };
}

function outcome(
  trajectory: Trajectory,
  position: number,
  hoursSinceActivation: number,
): Outcome | undefined {
  const result = movement(trajectory, hoursSinceActivation);
  if (!result || result.start < position) return;
  return { ...result, success: result.net >= position };
}

function capacityBucket(value?: Features): string {
  if (!value?.venueCapacity) return "unknown";
  const venueUse = value.capacity / value.venueCapacity;
  const occupancy = value.enroll / value.capacity;
  const reservation = value.reservationQuota
    ? value.reservationEnroll / value.reservationQuota < 0.8
      ? "reserved-open"
      : "reserved-full"
    : "unreserved";
  return `${venueUse < 0.65 ? "low" : venueUse < 0.9 ? "medium" : "full"}:${occupancy < 0.8 ? "open" : "occupied"}:${reservation}`;
}

// ponytail: coarse timing buckets; replace only if held-out calibration justifies it.
function timingBucket(
  trajectory: Trajectory,
  hoursSinceActivation: number,
): [number, number] | undefined {
  const activation = trajectory.events.find((event) => event.wait > 0)?.at;
  if (activation === undefined) return;
  const observed = activation + hoursSinceActivation * 3_600_000;
  const sinceNormal =
    (observed - Date.parse(terms[trajectory.term].enrollmentStart)) /
    86_400_000;
  const untilDeadline =
    (Date.parse(terms[trajectory.term].addDropEnd) - observed) / 86_400_000;
  return [Math.floor(sinceNormal / 2), Math.floor(untilDeadline / 3)];
}

function timingClose(
  sample: Trajectory,
  candidate: Trajectory,
  hours: number,
): boolean {
  const left = timingBucket(sample, hours);
  const right = timingBucket(candidate, hours);
  return Boolean(
    left &&
      right &&
      Math.abs(left[0] - right[0]) <= 1 &&
      Math.abs(left[1] - right[1]) <= 1,
  );
}

function localMatch(
  sample: Trajectory,
  candidate: Trajectory,
  model: ModelName,
  seasonal: boolean,
  hours: number,
): boolean {
  if (
    model === "global" ||
    sample.course !== candidate.course ||
    sample.type !== candidate.type ||
    !timingClose(sample, candidate, hours) ||
    (seasonal && terms[sample.term].season !== terms[candidate.term].season)
  )
    return false;
  if (model === "capacity" || model === "all")
    if (
      capacityBucket(sample.activationFeatures) !==
      capacityBucket(candidate.activationFeatures)
    )
      return false;
  if (model === "instructor" || model === "all")
    if (
      sample.activationFeatures?.instructor !==
      candidate.activationFeatures?.instructor
    )
      return false;
  if (model === "meeting" || model === "all")
    if (
      sample.activationFeatures?.meeting !==
      candidate.activationFeatures?.meeting
    )
      return false;
  return true;
}

type Eligible = { result: Outcome; sample: Trajectory };
type Evidence = {
  local: Outcome[];
  prior: number;
  priorSamples: number;
  successes: number;
};
type EvaluationCase = Evidence & { actual: boolean };

function evidence(
  eligible: Eligible[],
  candidate: Trajectory,
  hours: number,
  model: ModelName,
): Evidence | undefined {
  let priorPopulation = eligible.filter(
    ({ sample }) =>
      sample.type === candidate.type && timingClose(sample, candidate, hours),
  );
  if (!priorPopulation.length)
    priorPopulation = eligible.filter(
      ({ sample }) => sample.type === candidate.type,
    );
  if (!priorPopulation.length) return;
  const prior =
    priorPopulation.filter(({ result }) => result.success).length /
    priorPopulation.length;
  let local = eligible.filter(({ sample }) =>
    localMatch(sample, candidate, model, true, hours),
  );
  if (!local.length)
    local = eligible.filter(({ sample }) =>
      localMatch(sample, candidate, model, false, hours),
    );
  return {
    local: local.map(({ result }) => result),
    prior,
    priorSamples: priorPopulation.length,
    successes: local.filter(({ result }) => result.success).length,
  };
}

function prediction(
  training: Trajectory[],
  candidate: Trajectory,
  position: number,
  hours: number,
  model: ModelName,
  priorWeight: number,
):
  | {
      estimate: number;
      local: Outcome[];
      prior: number;
      priorSamples: number;
    }
  | undefined {
  const eligible = training
    .map((sample) => ({ sample, result: outcome(sample, position, hours) }))
    .filter((item): item is Eligible => Boolean(item.result));
  const result = evidence(eligible, candidate, hours, model);
  if (!result) return;
  return {
    estimate:
      (result.successes + priorWeight * result.prior) /
      (result.local.length + priorWeight),
    local: result.local,
    prior: result.prior,
    priorSamples: result.priorSamples,
  };
}

function evaluationCases(
  trajectories: Trajectory[],
  model: ModelName,
  position: number,
  hours: number,
): EvaluationCase[] {
  const cases: EvaluationCase[] = [];
  for (const heldOutTerm of ["2510", "2530"] as HistoricalTerm[]) {
    const earlier = trajectories.filter(
      (sample) =>
        Date.parse(terms[sample.term].addDropEnd) <
        Date.parse(terms[heldOutTerm].addDropEnd),
    );
    const eligible = earlier
      .map((sample) => ({ sample, result: outcome(sample, position, hours) }))
      .filter((item): item is Eligible => Boolean(item.result));
    for (const candidate of trajectories.filter(
      (sample) => sample.term === heldOutTerm,
    )) {
      const actual = outcome(candidate, position, hours);
      if (!actual) continue;
      const result = evidence(eligible, candidate, hours, model);
      if (result) cases.push({ ...result, actual: actual.success });
    }
  }
  return cases;
}

const tuningPositions = [5, 25, 50];
const tuningHours = [12, 24, 48];
const priorWeights = [0.5, 1, 2, 4, 8, 16, 32];

function score(
  cells: EvaluationCase[][],
  priorWeight: number,
): { brier: number; exact: number; total: number } {
  const briers = cells
    .filter((cases) => cases.length)
    .map(
      (cases) =>
        cases.reduce((sum, item) => {
          const estimate =
            (item.successes + priorWeight * item.prior) /
            (item.local.length + priorWeight);
          return sum + (estimate - Number(item.actual)) ** 2;
        }, 0) / cases.length,
    );
  return {
    brier: briers.reduce((sum, value) => sum + value, 0) / briers.length,
    exact: cells.flat().filter((item) => item.local.length).length,
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
  const cells = tuningPositions.flatMap((position) =>
    tuningHours.map((hours) =>
      evaluationCases(trajectories, model, position, hours),
    ),
  );
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

async function currentHuma(): Promise<CurrentClass> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(`
      WITH course AS (
        SELECT term_code, id
        FROM read_parquet('https://huggingface.co/datasets/ust-archive/schedule/resolve/main/courses.parquet')
        WHERE term_code = '2610' AND prefix = 'HUMA' AND number = '1710'
        QUALIFY row_number() OVER (PARTITION BY term_code, id ORDER BY "timestamp" DESC) = 1
      ), history AS (
        SELECT c.*
        FROM read_parquet('https://huggingface.co/datasets/ust-archive/schedule/resolve/main/classes.parquet') c
        JOIN course o ON o.term_code = c.term_code AND o.id = c.course_id
        WHERE c.section = 'L1'
      )
      SELECT capacity::INTEGER AS capacity, enroll::INTEGER AS enroll,
        wait::INTEGER AS wait, epoch_ms("timestamp") AS observed_at,
        (SELECT min(epoch_ms("timestamp")) FROM history WHERE wait > 0) AS activation,
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
    const venueCapacities = schedules
      .map((meeting) => /\((\d+)\)\s*$/.exec(meeting.venue_name)?.[1])
      .filter(Boolean)
      .map(Number);
    return {
      activation: Number(row.activation),
      capacity: Number(row.capacity),
      enroll: Number(row.enroll),
      instructor:
        schedules.flatMap((meeting) => meeting.instructors).sort()[0] ?? "TBA",
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
      venueCapacity: venueCapacities.length
        ? Math.max(...venueCapacities)
        : undefined,
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
  const sample: Trajectory = {
    term: "2510",
    course: "TEST1000",
    section: "L1",
    type: "LEC",
    events: [
      { at: 0, wait: 0 },
      { at: 3_600_000, wait: 30 },
      { at: 7_200_000, wait: 20 },
      { at: 10_800_000, wait: 25 },
      { at: 14_400_000, wait: 10 },
    ],
  };
  const result = outcome(sample, 20, 0);
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
    events: waits.map((wait, index) => ({ at: index * 3_600_000, wait })),
    section,
    term: "2410",
    type,
  });
  const bundle = bundleTrajectories([
    make("L1", "LEC", [0, 30, 10]),
    make("LA1", "LAB", [0, 12, 2]),
  ])[0];
  const favorable = bundle
    ? jointOutcome(bundle, { LAB: 5, LEC: 20 }, { LAB: 0, LEC: 0 })
    : undefined;
  const failed = bundle
    ? jointOutcome(bundle, { LAB: 11, LEC: 20 }, { LAB: 0, LEC: 0 })
    : undefined;
  if (!favorable?.success || failed?.success !== false)
    throw new Error("joint movement self-check failed");
}

selfCheck();
jointSelfCheck();
if (process.argv.includes("--self-check")) {
  console.log("Waitlist single-Class and joint self-checks passed");
  process.exit(0);
}
console.error("Extracting historical queue trajectories…");
const trajectories = await extractTrajectories();
const current = await currentHuma();
const position = 25;
const hoursSinceActivation = Math.max(
  0,
  (current.timestamp - current.activation) / 3_600_000,
);
const modelResults = (
  [
    "global",
    "baseline",
    "capacity",
    "instructor",
    "meeting",
    "all",
  ] as ModelName[]
).map((model) => ({ model, ...tune(trajectories, model) }));
const retained = [...modelResults].sort((a, b) => a.brier - b.brier)[0];

const bundles = bundleTrajectories(trajectories as WaitlistTrajectory[]);
const jointModelResults = (
  [
    "global",
    "baseline",
    "capacity",
    "instructor",
    "meeting",
    "all",
  ] as WaitlistModelName[]
).map((model) => ({ model, ...tuneJoint(bundles, model) }));
const retainedJoint = [...jointModelResults].sort(
  (a, b) =>
    (Number.isNaN(a.brier) ? Number.POSITIVE_INFINITY : a.brier) -
    (Number.isNaN(b.brier) ? Number.POSITIVE_INFINITY : b.brier),
)[0];
if (!retainedJoint) throw new Error("No joint model result was available");
const jointBundle = bundles.find((bundle) => bundle.components.length >= 2);
const jointCandidate = jointBundle
  ? planForBundle(jointBundle, 25, 24)
  : undefined;
const jointPredictionResult = jointCandidate
  ? jointPrediction(
      bundles,
      jointCandidate,
      retainedJoint.model,
      retainedJoint.weight,
    )
  : undefined;
const jointUncertainty = jointPredictionResult
  ? jointInterval(
      jointPredictionResult.estimate,
      jointPredictionResult.local.length,
      retainedJoint.weight,
    )
  : undefined;

const target: Trajectory = {
  activationFeatures: current,
  course: "HUMA1710",
  events: [{ at: current.activation, wait: current.wait }],
  section: "L1",
  term: "2610",
  type: "LEC",
};
const targetPrediction = prediction(
  trajectories,
  target,
  position,
  hoursSinceActivation,
  retained.model,
  retained.weight,
);
if (!targetPrediction) throw new Error("No historical LEC prior was available");
const uncertainty = interval(
  targetPrediction.estimate,
  targetPrediction.local.length,
  retained.weight,
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

const historicalHuma = trajectories.find(
  (trajectory) =>
    trajectory.term === "2510" &&
    trajectory.course === "HUMA1710" &&
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
const termRows = (
  Object.keys(terms).filter((term) => term !== "2610") as HistoricalTerm[]
).map((term) => {
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
    `| ${result.model} | ${result.weight} | ${Number.isNaN(result.brier) ? "n/a" : result.brier.toFixed(4)} | ${result.exact}/${result.total} | ${result.model === retainedJoint.model ? "Retain" : "Reject"} |`,
);
const jointPattern = jointBundle?.pattern ?? "none";
const jointHeadline =
  jointPredictionResult && jointUncertainty
    ? formatHeadline(
        jointPredictionResult.estimate,
        jointPredictionResult.local.length,
        retainedJoint.weight,
      )
    : "Unavailable (no two-component Course Offering in the source)";
const jointCalculation = jointPredictionResult
  ? `(${jointPredictionResult.successes} + ${retainedJoint.weight} × ${jointPredictionResult.prior.toFixed(3)}) ÷ (${jointPredictionResult.local.length} + ${retainedJoint.weight}) = ${jointPredictionResult.estimate.toFixed(3)}`
  : "not available";

const report = `# Waitlist queue-evidence prototype

**Question:** Can aggregate UST Class history provide useful queue evidence without claiming to know an individual student's enrollment outcome?

Generated directly from the current and legacy relations in the [Schedule dataset](https://huggingface.co/datasets/ust-archive/schedule), with hard-coded dates from confirmed HKUST Registry PDFs.

## Data coverage

| Term | Season | Normal enrollment start | Add/drop end | Class trajectories | Ever waitlisted |
| --- | --- | --- | --- | ---: | ---: |
${termRows.join("\n")}

- Total trajectories: **${trajectories.length}**
- Ever waitlisted: **${waitlisted.length}**
- Alignment: hours since normal enrollment start, hours since Queue Activation, and time until add/drop (nearby timing buckets are pooled)
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

This tuning is provisional: Fall 2026 remains incomplete and is reserved as the next untouched evaluation Term.

## Joint Waitlist Plan demonstration

The joint model groups required Classes from one historical Course Offering before calculating outcomes. A favorable sample requires every selected component to clear its own position; marginal component percentages are never multiplied.

- Historical component pattern: **${jointPattern}**
- Joint headline for position 25 on each component: **${jointHeadline}**
- Exact Course-Offering histories: **${jointPredictionResult?.local.length ?? 0}** (${jointPredictionResult?.successes ?? 0} favorable); broader same-pattern histories: **${jointPredictionResult?.priorSamples ?? 0}** at **${jointPredictionResult ? percent(jointPredictionResult.prior) : "n/a"}**
- Separate Queue Activation clocks are used for each component. Section labels remain identifiers only.
- Joint smoothing calculation: \`${jointCalculation}\`.
- Self-check favorable plan: LEC position 20 + LAB position 5 is favorable. Self-check failed plan: the same LEC position 20 + LAB position 11 is not favorable, because AND semantics require both components to clear.

| Candidate matching | Prior weight | Brier | Local-match coverage | Decision |
| --- | ---: | ---: | ---: | --- |
${jointModelRows.join("\n")}

The retained joint candidate is **${retainedJoint.model}** with prior weight **${retainedJoint.weight}**. Exact smoothing is independent of the single-Class provisional result above.

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
> Broader-prior influence: **${retained.weight}-history equivalent**; this is not the student's enrollment probability.

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
- Sparse exact evidence is shrunk toward the broader same-type rate using held-out prior weight ${retained.weight}; it is never displayed as an unsupported raw 0% or 100%.
- Headline calculation: \`(${localSuccesses} + ${retained.weight} × ${targetPrediction.prior.toFixed(3)}) ÷ (${targetPrediction.local.length} + ${retained.weight}) = ${targetPrediction.estimate.toFixed(3)}\`.
- The ± value is an estimated uncertainty margin; the explicit range is capped to 0–100% and may therefore be asymmetric.
- Net reduction and observed exits are diagnostics, not mathematical probability bounds.

</details>

## Verdict

The prototype always returns a transparent historical-evidence estimate, but release still requires the retained model to beat simpler alternatives consistently across Terms and queue positions. Reservation eligibility is not requested because the archive cannot calibrate subgroup outcomes. Official dates remain a checked static table until unsupported Terms justify a feed integration.
`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, report);
console.log(output);

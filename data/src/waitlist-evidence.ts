export const WAITLIST_TERMS = {
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

export type WaitlistTermCode = keyof typeof WAITLIST_TERMS;
export type WaitlistSeason = "Fall" | "Spring";
export type WaitlistEvent = { at: number; wait: number };
export type WaitlistFeatures = {
  capacity: number;
  enroll: number;
  instructor: string;
  meeting: string;
  reservationEnroll: number;
  reservationQuota: number;
  venueCapacity?: number;
};
export type WaitlistTrajectory = {
  activationFeatures?: WaitlistFeatures;
  association?: number;
  course: string;
  events: WaitlistEvent[];
  section: string;
  term: string;
  type: string;
};
export type WaitlistMovement = { gross: number; net: number; start: number };
export type WaitlistOutcome = WaitlistMovement & { success: boolean };
export type WaitlistModelName =
  | "global"
  | "baseline"
  | "capacity"
  | "instructor"
  | "meeting"
  | "all";

export type WaitlistComponent = {
  trajectory: WaitlistTrajectory;
  type: string;
};
export type WaitlistBundle = {
  components: WaitlistComponent[];
  course: string;
  pattern: string;
  season: WaitlistSeason;
  term: string;
};
export type WaitlistPlanCandidate = {
  activationAt?: Record<string, number>;
  activationHours: Record<string, number>;
  course: string;
  features?: Record<string, WaitlistFeatures | undefined>;
  pattern: string;
  positions: Record<string, number>;
  season: WaitlistSeason;
  term?: string;
};
export type WaitlistJointOutcome = {
  components: Record<string, WaitlistOutcome>;
  success: boolean;
};
export type WaitlistEvidence = {
  local: WaitlistJointOutcome[];
  prior: number;
  priorSamples: number;
  successes: number;
};
export type WaitlistPrediction = WaitlistEvidence & {
  estimate: number;
};
export type WaitlistEvaluationCase = WaitlistEvidence & { actual: boolean };
export type WaitlistTuneResult = {
  brier: number;
  exact: number;
  scores: Array<{ brier: number; weight: number }>;
  total: number;
  weight: number;
};

export const WAITLIST_TUNING_POSITIONS = [5, 25, 50] as const;
export const WAITLIST_TUNING_HOURS = [12, 24, 48] as const;
export const WAITLIST_PRIOR_WEIGHTS = [0.5, 1, 2, 4, 8, 16, 32] as const;

function termInfo(term: string) {
  return WAITLIST_TERMS[term as WaitlistTermCode];
}

function season(term: string): WaitlistSeason | undefined {
  const value = termInfo(term)?.season;
  return value === "Fall" || value === "Spring" ? value : undefined;
}

function typeKey(type: string): string {
  return type.trim().toUpperCase() || "IND";
}

function componentPattern(types: Iterable<string>): string {
  return [...new Set([...types].map(typeKey))].sort().join("+");
}

function associationKey(trajectory: WaitlistTrajectory): string {
  return trajectory.association === undefined
    ? "offering"
    : `association:${trajectory.association}`;
}

/** Group component trajectories without treating a Course Offering's queues as independent samples. */
export function bundleTrajectories(
  trajectories: readonly WaitlistTrajectory[],
): WaitlistBundle[] {
  const groups = new Map<string, WaitlistTrajectory[]>();
  for (const trajectory of trajectories) {
    const key = `${trajectory.term}\0${trajectory.course}\0${associationKey(trajectory)}`;
    const group = groups.get(key) ?? [];
    group.push(trajectory);
    groups.set(key, group);
  }
  const bundles: WaitlistBundle[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const groupSeason = first ? season(first.term) : undefined;
    if (!first || !groupSeason) continue;
    const byType = new Map<string, WaitlistTrajectory>();
    for (const trajectory of [...group].sort((left, right) =>
      left.section.localeCompare(right.section),
    )) {
      const key = typeKey(trajectory.type);
      if (!byType.has(key)) byType.set(key, trajectory);
    }
    const components = [...byType.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, trajectory]) => ({ type, trajectory }));
    if (components.length === 0) continue;
    bundles.push({
      components,
      course: first.course,
      pattern: componentPattern(components.map(({ type }) => type)),
      season: groupSeason,
      term: first.term,
    });
  }
  return bundles.sort(
    (left, right) =>
      left.term.localeCompare(right.term) ||
      left.course.localeCompare(right.course) ||
      left.pattern.localeCompare(right.pattern) ||
      left.components
        .map(({ trajectory }) => trajectory.section)
        .join("+")
        .localeCompare(
          right.components
            .map(({ trajectory }) => trajectory.section)
            .join("+"),
        ),
  );
}

export function movement(
  trajectory: WaitlistTrajectory,
  hoursSinceActivation: number,
): WaitlistMovement | undefined {
  const activationIndex = trajectory.events.findIndex(
    (event) => event.wait > 0,
  );
  if (activationIndex < 0 || !Number.isFinite(hoursSinceActivation)) return;
  const deadline = termInfo(trajectory.term)
    ? Date.parse(termInfo(trajectory.term)?.addDropEnd as string)
    : Number.POSITIVE_INFINITY;
  const cutoff =
    trajectory.events[activationIndex].at + hoursSinceActivation * 3_600_000;
  const events = trajectory.events.filter((event) => event.at <= deadline);
  const startIndex = events.findLastIndex((event) => event.at <= cutoff);
  if (startIndex < activationIndex) return;
  const future = events.slice(startIndex);
  const start = future[0]?.wait;
  if (start === undefined) return;
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

export function outcome(
  trajectory: WaitlistTrajectory,
  position: number,
  hoursSinceActivation: number,
): WaitlistOutcome | undefined {
  if (!Number.isSafeInteger(position) || position <= 0) return;
  const result = movement(trajectory, hoursSinceActivation);
  if (!result || result.start < position) return;
  return { ...result, success: result.net >= position };
}

function activationAt(trajectory: WaitlistTrajectory): number | undefined {
  return trajectory.events.find((event) => event.wait > 0)?.at;
}

function timingBucket(
  trajectory: WaitlistTrajectory,
  hoursSinceActivation: number,
): [number, number] | undefined {
  const info = termInfo(trajectory.term);
  const activation = activationAt(trajectory);
  if (!info || activation === undefined) return;
  const observed = activation + hoursSinceActivation * 3_600_000;
  return [
    Math.floor((observed - Date.parse(info.enrollmentStart)) / 86_400_000 / 2),
    Math.floor((Date.parse(info.addDropEnd) - observed) / 86_400_000 / 3),
  ];
}

function candidateTimingBucket(
  candidate: WaitlistPlanCandidate,
  type: string,
): [number, number] | undefined {
  const activation = candidate.activationAt?.[type];
  const info = termInfo(candidate.term ?? "");
  const hours = candidate.activationHours[type];
  if (activation === undefined || !info || !Number.isFinite(hours)) return;
  const observed = activation + hours * 3_600_000;
  return [
    Math.floor((observed - Date.parse(info.enrollmentStart)) / 86_400_000 / 2),
    Math.floor((Date.parse(info.addDropEnd) - observed) / 86_400_000 / 3),
  ];
}

function timingClose(
  sample: WaitlistBundle,
  candidate: WaitlistPlanCandidate,
): boolean {
  return sample.components.every(({ type, trajectory }) => {
    const hours = candidate.activationHours[type] ?? 0;
    const left = timingBucket(trajectory, hours);
    const right = candidate.activationAt
      ? candidateTimingBucket(candidate, type)
      : left;
    return Boolean(
      left &&
        right &&
        Math.abs(left[0] - right[0]) <= 1 &&
        Math.abs(left[1] - right[1]) <= 1,
    );
  });
}

function capacityBucket(value?: WaitlistFeatures): string {
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

function sameFeatures(
  sample: WaitlistBundle,
  candidate: WaitlistPlanCandidate,
  kind: "capacity" | "instructor" | "meeting",
): boolean {
  return sample.components.every(({ type, trajectory }) => {
    const sampleFeatures = trajectory.activationFeatures;
    const candidateFeatures = candidate.features?.[type];
    if (!sampleFeatures || !candidateFeatures) return false;
    if (kind === "capacity")
      return (
        capacityBucket(sampleFeatures) === capacityBucket(candidateFeatures)
      );
    return sampleFeatures[kind] === candidateFeatures[kind];
  });
}

function modelMatch(
  sample: WaitlistBundle,
  candidate: WaitlistPlanCandidate,
  model: WaitlistModelName,
  seasonal: boolean,
): boolean {
  if (sample.pattern !== candidate.pattern) return false;
  if (model !== "global" && sample.course !== candidate.course) return false;
  if (seasonal && sample.season !== candidate.season) return false;
  if (!timingClose(sample, candidate)) return false;
  if (model === "capacity" || model === "all")
    if (!sameFeatures(sample, candidate, "capacity")) return false;
  if (model === "instructor" || model === "all")
    if (!sameFeatures(sample, candidate, "instructor")) return false;
  if (model === "meeting" || model === "all")
    if (!sameFeatures(sample, candidate, "meeting")) return false;
  return true;
}

export function jointOutcome(
  bundle: WaitlistBundle,
  positions: Record<string, number>,
  activationHours: Record<string, number>,
): WaitlistJointOutcome | undefined {
  const components: Record<string, WaitlistOutcome> = {};
  for (const type of Object.keys(positions).map(typeKey)) {
    const component = bundle.components.find((item) => item.type === type);
    const position = positions[type];
    const result = component
      ? outcome(component.trajectory, position, activationHours[type] ?? 0)
      : undefined;
    if (!result) return;
    components[type] = result;
  }
  if (Object.keys(components).length === 0) return;
  return {
    components,
    success: Object.values(components).every((result) => result.success),
  };
}

function planOutcome(
  bundle: WaitlistBundle,
  candidate: WaitlistPlanCandidate,
): WaitlistJointOutcome | undefined {
  return jointOutcome(bundle, candidate.positions, candidate.activationHours);
}

function evidenceFor(
  eligible: Array<{ bundle: WaitlistBundle; result: WaitlistJointOutcome }>,
  candidate: WaitlistPlanCandidate,
  model: WaitlistModelName,
): WaitlistEvidence | undefined {
  const patternPopulation = eligible.filter(
    ({ bundle }) =>
      bundle.pattern === candidate.pattern && timingClose(bundle, candidate),
  );
  const priorPopulation = patternPopulation.length
    ? patternPopulation
    : eligible.filter(({ bundle }) => bundle.pattern === candidate.pattern);
  if (!priorPopulation.length) return;
  const prior =
    priorPopulation.filter(({ result }) => result.success).length /
    priorPopulation.length;
  let local = eligible.filter(({ bundle }) =>
    modelMatch(bundle, candidate, model, true),
  );
  if (!local.length)
    local = eligible.filter(({ bundle }) =>
      modelMatch(bundle, candidate, model, false),
    );
  return {
    local: local.map(({ result }) => result),
    prior,
    priorSamples: priorPopulation.length,
    successes: local.filter(({ result }) => result.success).length,
  };
}

export function evidence(
  training: readonly WaitlistBundle[],
  candidate: WaitlistPlanCandidate,
  model: WaitlistModelName,
): WaitlistEvidence | undefined {
  const eligible = training.flatMap((bundle) => {
    const result = planOutcome(bundle, candidate);
    return result ? [{ bundle, result }] : [];
  });
  return evidenceFor(eligible, candidate, model);
}

export function prediction(
  training: readonly WaitlistBundle[],
  candidate: WaitlistPlanCandidate,
  model: WaitlistModelName,
  priorWeight: number,
): WaitlistPrediction | undefined {
  const result = evidence(training, candidate, model);
  if (!result) return;
  return {
    ...result,
    estimate:
      (result.successes + priorWeight * result.prior) /
      (result.local.length + priorWeight),
  };
}

export function planForBundle(
  bundle: WaitlistBundle,
  position: number,
  hours: number,
): WaitlistPlanCandidate {
  return {
    activationAt: Object.fromEntries(
      bundle.components.map(({ type, trajectory }) => [
        type,
        activationAt(trajectory),
      ]),
    ) as Record<string, number>,
    activationHours: Object.fromEntries(
      bundle.components.map(({ type }) => [type, hours]),
    ),
    course: bundle.course,
    features: Object.fromEntries(
      bundle.components.map(({ type, trajectory }) => [
        type,
        trajectory.activationFeatures,
      ]),
    ),
    pattern: bundle.pattern,
    positions: Object.fromEntries(
      bundle.components.map(({ type }) => [type, position]),
    ),
    season: bundle.season,
    term: bundle.term,
  };
}

export function evaluationCases(
  bundles: readonly WaitlistBundle[],
  model: WaitlistModelName,
  position: number,
  hours: number,
  heldOutTerms: readonly string[] = ["2510", "2530"],
): WaitlistEvaluationCase[] {
  const cases: WaitlistEvaluationCase[] = [];
  for (const heldOutTerm of heldOutTerms) {
    const heldOutEnd = termInfo(heldOutTerm)?.addDropEnd;
    if (!heldOutEnd) continue;
    const training = bundles.filter((bundle) => {
      const end = termInfo(bundle.term)?.addDropEnd;
      return end !== undefined && Date.parse(end) < Date.parse(heldOutEnd);
    });
    for (const candidateBundle of bundles.filter(
      (bundle) => bundle.term === heldOutTerm,
    )) {
      const candidate = planForBundle(candidateBundle, position, hours);
      const actual = planOutcome(candidateBundle, candidate);
      const result = evidence(training, candidate, model);
      if (actual && result) cases.push({ ...result, actual: actual.success });
    }
  }
  return cases;
}

function score(
  cells: readonly (readonly WaitlistEvaluationCase[])[],
  priorWeight: number,
): { brier: number; exact: number; total: number } {
  const populated = cells.filter((items) => items.length > 0);
  const brier = populated.length
    ? populated.reduce(
        (sum, cases) =>
          sum +
          cases.reduce((cellSum, item) => {
            const estimate =
              (item.successes + priorWeight * item.prior) /
              (item.local.length + priorWeight);
            return cellSum + (estimate - Number(item.actual)) ** 2;
          }, 0) /
            cases.length,
        0,
      ) / populated.length
    : Number.NaN;
  return {
    brier,
    exact: cells.flat().filter((item) => item.local.length > 0).length,
    total: cells.flat().length,
  };
}

export function tuneJoint(
  bundles: readonly WaitlistBundle[],
  model: WaitlistModelName,
): WaitlistTuneResult {
  const cells = WAITLIST_TUNING_POSITIONS.flatMap((position) =>
    WAITLIST_TUNING_HOURS.map((hours) =>
      evaluationCases(bundles, model, position, hours),
    ),
  );
  const scores = WAITLIST_PRIOR_WEIGHTS.map((weight) => ({
    ...score(cells, weight),
    weight,
  }));
  const best = [...scores].sort(
    (left, right) =>
      (Number.isNaN(left.brier) ? Number.POSITIVE_INFINITY : left.brier) -
        (Number.isNaN(right.brier) ? Number.POSITIVE_INFINITY : right.brier) ||
      left.weight - right.weight,
  )[0];
  if (!best) throw new Error("No prior weights configured");
  return { ...best, scores };
}

export function interval(
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

export function formatHeadline(
  estimate: number,
  sampleSize: number,
  priorWeight: number,
): string {
  const uncertainty = interval(estimate, sampleSize, priorWeight);
  const displayedEstimate = Math.round(estimate * 100);
  const low = Math.round(uncertainty.low * 100);
  const high = Math.round(uncertainty.high * 100);
  const margin = Math.max(displayedEstimate - low, high - displayedEstimate);
  return `${displayedEstimate}% ±${margin} pp (${low}–${high}%)`;
}

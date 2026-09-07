import assert from "node:assert/strict";
import type { Protocol } from "./prospective-seal.ts";

export type ForecastRow = {
  candidateId: string;
  cutoffTerm: number;
  family: "course" | "instructor";
  entityId: string;
  criterion: string;
  prediction: number;
  modelStddev: number;
};

export type OutcomeRow = {
  observationId: string;
  sourceRevision: string;
  term: number;
  family: "course" | "instructor";
  entityId: string | null;
  criterion: string;
  source: string;
  rating: number;
  sourceStddev: number | null;
  samples: number;
  weight: number;
};

type Pair = { outcome: OutcomeRow; forecast: ForecastRow; unit: string };
const criteria = ["course", "content", "teaching", "grading", "workload"];
const levels = [
  { target: 0.5, z: 0.6744897501960817 },
  { target: 0.8, z: 1.2815515655446004 },
  { target: 0.9, z: 1.6448536269514722 },
  { target: 0.95, z: 1.959963984540054 },
];
const key = (...values: unknown[]) => JSON.stringify(values);
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const finite = (
  value: number,
  label: string,
  minimum: number,
  maximum = Infinity,
) =>
  assert(
    Number.isFinite(value) && value >= minimum && value <= maximum,
    `Invalid ${label}`,
  );
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const validCriterion = (family: string, criterion: string) =>
  family === "course"
    ? criteria.includes(criterion)
    : family === "instructor" && criterion === "instructor";
const unitKey = (row: OutcomeRow) =>
  key(
    row.family,
    row.entityId,
    row.term,
    row.family === "course" ? row.criterion : null,
  );
const forecastKey = (row: Omit<ForecastRow, "prediction" | "modelStddev">) =>
  key(row.candidateId, row.cutoffTerm, row.family, row.entityId, row.criterion);
const error = (pair: Pair) =>
  Math.abs(pair.forecast.prediction - pair.outcome.rating);

function unitErrors(pairs: Pair[]) {
  return [...Map.groupBy(pairs, (pair) => pair.unit)].map(([unit, rows]) => {
    const first = rows[0];
    assert(first);
    assert(
      rows.every(
        (row) =>
          row.forecast.prediction === first.forecast.prediction &&
          row.forecast.cutoffTerm === first.forecast.cutoffTerm,
      ),
      "A primary unit requires one common forecast",
    );
    const signed =
      first.forecast.prediction - mean(rows.map((row) => row.outcome.rating));
    return {
      unit,
      entityId: first.forecast.entityId,
      term: first.outcome.term,
      criterion: first.outcome.criterion,
      error: Math.abs(signed),
      signed,
    };
  });
}

function summarize(pairs: Pair[]) {
  const units = unitErrors(pairs);
  const weighted = (field: "weight" | "samples") => {
    const total = pairs.reduce((sum, pair) => sum + pair.outcome[field], 0);
    return total > 0
      ? pairs.reduce(
          (sum, pair) => sum + error(pair) * pair.outcome[field],
          0,
        ) / total
      : null;
  };
  const groups = (field: "source" | "criterion") =>
    [...Map.groupBy(pairs, (pair) => pair.outcome[field])]
      .map(([value, rows]) => ({
        value,
        units: unitErrors(rows).length,
        meanAbsoluteError: mean(unitErrors(rows).map((row) => row.error)),
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  return {
    units: units.length,
    rawObservations: pairs.length,
    primaryMeanAbsoluteError: mean(units.map((row) => row.error)),
    equalEntityMeanAbsoluteError: mean(
      [...Map.groupBy(units, (row) => row.entityId).values()].map((rows) =>
        mean(rows.map((row) => row.error)),
      ),
    ),
    equalCriterionMeanAbsoluteError: mean(
      [...Map.groupBy(units, (row) => row.criterion).values()].map((rows) =>
        mean(rows.map((row) => row.error)),
      ),
    ),
    rawObservationMeanAbsoluteError: mean(pairs.map(error)),
    sourceWeightedMeanAbsoluteError: weighted("weight"),
    respondentWeightedMeanAbsoluteError: weighted("samples"),
    equalUnitSignedError: mean(units.map((row) => row.signed)),
    byCriterion: groups("criterion"),
    bySource: groups("source"),
    intervalCoverage: levels.map(({ target, z }) => ({
      target,
      pairs: pairs.length,
      coverage: mean(
        pairs.map((pair) => {
          const sd = Math.sqrt(
            pair.forecast.modelStddev ** 2 +
              (pair.outcome.sourceStddev ?? 0) ** 2 /
                Math.max(pair.outcome.samples, 1) +
              1 / pair.outcome.weight,
          );
          return Number(error(pair) <= z * sd);
        }),
      ),
    })),
  };
}

function pairedInterval(
  candidate: ReturnType<typeof unitErrors>,
  control: ReturnType<typeof unitErrors>,
  cluster: "entityId" | "term",
  protocol: Protocol,
) {
  const baseline = new Map(control.map((row) => [row.unit, row.error]));
  const differences = candidate.map((row) => {
    const value = baseline.get(row.unit);
    assert(value !== undefined, "Candidate comparison must use paired units");
    return { cluster: row[cluster], value: row.error - value };
  });
  const clusters = [
    ...Map.groupBy(differences, (row) => row.cluster).values(),
  ].map((rows) => ({
    sum: rows.reduce((sum, row) => sum + row.value, 0),
    count: rows.length,
  }));
  let state = protocol.bootstrap.seed;
  const estimates = Array.from(
    { length: protocol.bootstrap.replicates },
    () => {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < clusters.length; i++) {
        state = (1664525 * state + 1013904223) >>> 0;
        const selected =
          clusters[Math.floor((state / 2 ** 32) * clusters.length)];
        assert(selected);
        sum += selected.sum;
        count += selected.count;
      }
      return sum / count;
    },
  ).sort((a, b) => a - b);
  const quantile = (p: number) => {
    const position = (estimates.length - 1) * p;
    const low = estimates[Math.floor(position)];
    const high = estimates[Math.ceil(position)];
    assert(low !== undefined && high !== undefined);
    return low + (high - low) * (position - Math.floor(position));
  };
  return {
    estimate: mean(differences.map((row) => row.value)),
    lower95: quantile(0.025),
    upper95: quantile(0.975),
    clusters: clusters.length,
    replicates: protocol.bootstrap.replicates,
    seed: protocol.bootstrap.seed,
  };
}

/** Score only after protocol gates pass. File claims and seals are enforced by the caller. */
export function evaluateProspective(
  protocol: Protocol,
  forecasts: ForecastRow[],
  outcomes: OutcomeRow[],
  acceptedIdentitiesByCutoff: Record<string, string[]>,
) {
  const evaluatedCandidateIds = protocol.candidateRegistry.map(
    (candidate) => candidate.id,
  );
  const candidateIds = [...evaluatedCandidateIds, ...protocol.baselineRegistry];
  assert(
    new Set(candidateIds).size === candidateIds.length &&
      candidateIds.length > 1,
    "Invalid candidate registry",
  );
  const controlId = protocol.candidateRegistry.find(
    (candidate) => candidate.role === "control",
  )?.id;
  assert(
    controlId &&
      protocol.candidateRegistry.filter(
        (candidate) => candidate.role === "control",
      ).length === 1,
    "Exactly one control is required",
  );
  const accepted = new Map(
    Object.entries(acceptedIdentitiesByCutoff).map(([cutoff, ids]) => [
      Number(cutoff),
      new Set(ids),
    ]),
  );
  for (const ids of accepted.values())
    for (const id of ids)
      assert(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
        "Accepted Instructor identity must be a UUID",
      );
  const forecastMap = new Map<string, ForecastRow>();
  const cutoffCandidates = new Map<number, Set<string>>();
  for (const row of forecasts) {
    assert(
      candidateIds.includes(row.candidateId),
      "Unknown forecast candidate",
    );
    assert(
      Number.isInteger(row.cutoffTerm) && row.cutoffTerm >= 0,
      "Invalid forecast cutoff",
    );
    assert(
      nonempty(row.entityId) && validCriterion(row.family, row.criterion),
      "Invalid forecast entity or role/criterion",
    );
    finite(row.prediction, "forecast prediction", 1, 5);
    finite(row.modelStddev, "forecast standard deviation", 0);
    if (row.family === "instructor")
      assert(
        accepted.get(row.cutoffTerm)?.has(row.entityId),
        "Forecast Instructor must be accepted at its cutoff",
      );
    const identity = forecastKey(row);
    assert(!forecastMap.has(identity), "Duplicate forecast");
    forecastMap.set(identity, row);
    const candidates =
      cutoffCandidates.get(row.cutoffTerm) ?? new Set<string>();
    candidates.add(row.candidateId);
    cutoffCandidates.set(row.cutoffTerm, candidates);
  }
  for (const candidates of cutoffCandidates.values())
    assert(
      candidateIds.every((id) => candidates.has(id)),
      "Every sealed cutoff requires the complete candidate set",
    );
  const cutoffs = [...cutoffCandidates.keys()].sort((a, b) => b - a);
  const selectedCutoffsByOutcomeTerm: Record<string, number | null> = {};
  const pairs = new Map(candidateIds.map((id) => [id, [] as Pair[]]));
  const eligibleByCandidate = new Map(
    candidateIds.map((id) => [id, new Set<string>()]),
  );
  const seen = new Set<string>();
  const coverage = Object.fromEntries(
    (["course", "instructor"] as const).map((family) => [
      family,
      {
        rawOutcomes: 0,
        commonMatchedOutcomes: 0,
        unknownIdentityOutcomes: 0,
        missingCutoffOutcomes: 0,
        outsideHorizonOutcomes: 0,
        missingAnyCandidateForecastOutcomes: 0,
        matchedByCandidate: Object.fromEntries(
          candidateIds.map((id) => [id, 0]),
        ),
      },
    ]),
  ) as Record<
    "course" | "instructor",
    {
      rawOutcomes: number;
      commonMatchedOutcomes: number;
      unknownIdentityOutcomes: number;
      missingCutoffOutcomes: number;
      outsideHorizonOutcomes: number;
      missingAnyCandidateForecastOutcomes: number;
      matchedByCandidate: Record<string, number>;
    }
  >;
  const inputUnits = {
    course: new Set<string>(),
    instructor: new Set<string>(),
  };
  for (const row of outcomes) {
    assert(nonempty(row.observationId), "Missing outcome observation ID");
    assert(
      /^[a-f0-9]{40}$/.test(row.sourceRevision) &&
        !protocol.inspectedSourceRevisions.includes(row.sourceRevision),
      "Outcome revision must be immutable and previously uninspected",
    );
    assert(
      Number.isInteger(row.term) &&
        row.term >= protocol.firstOutcomeTerm &&
        row.term > protocol.knownOutcomeCeilingTerm,
      "Known or invalid outcome Term",
    );
    assert(
      validCriterion(row.family, row.criterion),
      "Invalid outcome role/criterion",
    );
    assert(
      row.source ===
        (row.criterion === "course" || row.criterion === "instructor"
          ? "sfq"
          : "review"),
      "Outcome source does not match its role/criterion",
    );
    assert(
      row.entityId === null || nonempty(row.entityId),
      "Invalid outcome entity",
    );
    finite(row.rating, "outcome rating", 1, 5);
    finite(row.samples, "outcome samples", 0);
    finite(row.weight, "outcome weight", Number.MIN_VALUE);
    if (row.sourceStddev !== null)
      finite(row.sourceStddev, "outcome standard deviation", 0);
    const observation = key(row.family, row.observationId);
    assert(!seen.has(observation), "Duplicate outcome observation");
    seen.add(observation);
    const counts = coverage[row.family];
    counts.rawOutcomes++;
    const cutoff = cutoffs.find((value) => value < row.term);
    selectedCutoffsByOutcomeTerm[row.term] = cutoff ?? null;
    if (row.entityId !== null) inputUnits[row.family].add(unitKey(row));
    if (cutoff === undefined) {
      counts.missingCutoffOutcomes++;
      continue;
    }
    if (row.term > cutoff + 4) {
      counts.outsideHorizonOutcomes++;
      continue;
    }
    if (
      row.entityId === null ||
      (row.family === "instructor" && !accepted.get(cutoff)?.has(row.entityId))
    ) {
      counts.unknownIdentityOutcomes++;
      continue;
    }
    const unit = unitKey(row);
    const entityId = row.entityId;
    const available = candidateIds.map((candidateId) =>
      forecastMap.get(
        forecastKey({
          candidateId,
          cutoffTerm: cutoff,
          family: row.family,
          entityId,
          criterion: row.criterion,
        }),
      ),
    );
    candidateIds.forEach((id, i) => {
      if (available[i]) {
        counts.matchedByCandidate[id] =
          (counts.matchedByCandidate[id] ?? 0) + 1;
        eligibleByCandidate.get(id)?.add(unit);
      }
    });
    if (available.some((row) => row === undefined)) {
      counts.missingAnyCandidateForecastOutcomes++;
      continue;
    }
    counts.commonMatchedOutcomes++;
    candidateIds.forEach((id, i) => {
      const forecast = available[i];
      assert(forecast);
      pairs.get(id)?.push({ outcome: row, forecast, unit });
    });
  }
  const common = pairs.get(controlId) ?? [];
  const coursePairs = common.filter((pair) => pair.outcome.family === "course");
  const instructorPairs = common.filter(
    (pair) => pair.outcome.family === "instructor",
  );
  const counts = {
    distinctOutcomeTerms: new Set(common.map((pair) => pair.outcome.term)).size,
    courseUnits: new Set(coursePairs.map((pair) => pair.unit)).size,
    distinctCourses: new Set(coursePairs.map((pair) => pair.forecast.entityId))
      .size,
    instructorUnits: new Set(instructorPairs.map((pair) => pair.unit)).size,
    distinctInstructors: new Set(
      instructorPairs.map((pair) => pair.forecast.entityId),
    ).size,
  };
  const referenceEligibility =
    eligibleByCandidate.get(controlId) ?? new Set<string>();
  const candidateUnitSetsIdentical = [...eligibleByCandidate.values()].every(
    (set) =>
      set.size === referenceEligibility.size &&
      [...set].every((unit) => referenceEligibility.has(unit)),
  );
  const minimums = protocol.sealWhen;
  const gates = {
    distinctOutcomeTerms:
      counts.distinctOutcomeTerms >= minimums.minimumDistinctOutcomeTerms,
    courseUnits: counts.courseUnits >= minimums.minimumCourseUnits,
    distinctCourses: counts.distinctCourses >= minimums.minimumDistinctCourses,
    instructorUnits: counts.instructorUnits >= minimums.minimumInstructorUnits,
    distinctInstructors:
      counts.distinctInstructors >= minimums.minimumDistinctInstructors,
    candidateUnitSetsIdentical,
    nonemptyCourseAndInstructorUnits:
      counts.courseUnits > 0 && counts.instructorUnits > 0,
  };
  const diagnostics = {
    counts,
    minimums,
    gates,
    selectedCutoffsByOutcomeTerm,
    coverage,
    knownEntityInputUnits: {
      course: inputUnits.course.size,
      instructor: inputUnits.instructor.size,
    },
  };
  if (!Object.values(gates).every(Boolean))
    return {
      status: "diagnostics-only" as const,
      accepted: false as const,
      productionPromotion: false as const,
      diagnostics,
      unmetGates: Object.entries(gates)
        .filter(([, passed]) => !passed)
        .map(([name]) => name),
    };
  const results = Object.fromEntries(
    candidateIds.map((id) => {
      const rows = pairs.get(id) ?? [];
      return [
        id,
        {
          course: summarize(
            rows.filter((pair) => pair.outcome.family === "course"),
          ),
          instructor: summarize(
            rows.filter((pair) => pair.outcome.family === "instructor"),
          ),
        },
      ];
    }),
  );
  const baseline = results[controlId];
  assert(baseline);
  const relativeChange = (candidate: number, control: number) =>
    control > 0 ? (candidate - control) / control : candidate === 0 ? 0 : null;
  const comparisons = evaluatedCandidateIds
    .filter((id) => id !== controlId)
    .map((id) => {
      const result = results[id];
      assert(result);
      const candidateCourse = (pairs.get(id) ?? []).filter(
        (pair) => pair.outcome.family === "course",
      );
      const units = unitErrors(candidateCourse);
      const controlUnits = unitErrors(coursePairs);
      const courseCluster = pairedInterval(
        units,
        controlUnits,
        "entityId",
        protocol,
      );
      const termBlock = pairedInterval(units, controlUnits, "term", protocol);
      const instructorUnits = unitErrors(
        (pairs.get(id) ?? []).filter(
          (pair) => pair.outcome.family === "instructor",
        ),
      );
      const controlInstructorUnits = unitErrors(instructorPairs);
      const instructorIntervals = {
        instructorCluster: pairedInterval(
          instructorUnits,
          controlInstructorUnits,
          "entityId",
          protocol,
        ),
        termBlock: pairedInterval(
          instructorUnits,
          controlInstructorUnits,
          "term",
          protocol,
        ),
      };
      const change = relativeChange(
        result.course.primaryMeanAbsoluteError,
        baseline.course.primaryMeanAbsoluteError,
      );
      const guardrails = (["byCriterion", "bySource"] as const).flatMap(
        (field) =>
          (field === "byCriterion" ? criteria : ["sfq", "review"]).map(
            (value) => {
              const group = result.course[field].find(
                (row) => row.value === value,
              );
              const control = baseline.course[field].find(
                (row) => row.value === value,
              );
              if (!group || !control)
                return {
                  dimension: field,
                  value,
                  assessed: false,
                  relativeRegression: null,
                  passed: false,
                };
              const regression = relativeChange(
                group.meanAbsoluteError,
                control.meanAbsoluteError,
              );
              return {
                dimension: field,
                value: group.value,
                assessed: true,
                relativeRegression: regression,
                passed:
                  regression !== null &&
                  regression <=
                    protocol.acceptance
                      .maximumRelativeRegressionInAnyPredeclaredCriterionOrSource,
              };
            },
          ),
      );
      const acceptance = {
        primaryImprovement:
          change !== null &&
          -change >= protocol.acceptance.minimumRelativePrimaryImprovement,
        courseCluster:
          !protocol.acceptance.requireCourseClusterUpper95BelowZero ||
          courseCluster.upper95 < 0,
        termBlock:
          !protocol.acceptance.requireTermBlockUpper95BelowZero ||
          termBlock.upper95 < 0,
        criterionAndSourceGuardrails: guardrails.every((row) => row.passed),
      };
      const baselineComparisons = protocol.baselineRegistry.map(
        (baselineId) => {
          const baselineResult = results[baselineId];
          assert(baselineResult);
          return {
            baselineId,
            primaryMeanAbsoluteError:
              baselineResult.course.primaryMeanAbsoluteError,
            pairedDifference:
              result.course.primaryMeanAbsoluteError -
              baselineResult.course.primaryMeanAbsoluteError,
            passed:
              result.course.primaryMeanAbsoluteError <
              baselineResult.course.primaryMeanAbsoluteError,
          };
        },
      );
      const coverageGates = Object.fromEntries(
        (["course", "instructor"] as const).map((family) => [
          family,
          result[family].intervalCoverage.map((row) => ({
            ...row,
            passed: row.coverage >= row.target,
          })),
        ]),
      );
      const pointErrorGuardrailsPassed =
        Object.values(acceptance).every(Boolean);
      const baselineGatePassed = baselineComparisons.every((row) => row.passed);
      const coverageGatePassed = Object.values(coverageGates).every((rows) =>
        rows.every((row) => row.passed),
      );
      return {
        candidateId: id,
        controlId,
        relativePrimaryImprovement: change === null ? null : -change,
        courseCluster,
        termBlock,
        instructorIntervals,
        guardrails,
        acceptance,
        pointErrorGuardrailsPassed,
        baselineComparisons,
        baselineGatePassed,
        coverageGates,
        coverageGatePassed,
        frozenMetricGatesPassed:
          pointErrorGuardrailsPassed &&
          baselineGatePassed &&
          coverageGatePassed,
        instructorImprovementClaim: false as const,
        unobservedCourseCriteria: criteria.filter(
          (criterion) =>
            !result.course.byCriterion.some((row) => row.value === criterion),
        ),
        unobservedCourseSources: ["sfq", "review"].filter(
          (source) =>
            !result.course.bySource.some((row) => row.value === source),
        ),
      };
    });
  return {
    status: "evaluated" as const,
    accepted: false as const,
    productionPromotion: false as const,
    diagnostics,
    results,
    comparisons,
    intervalRule: protocol.intervalRule,
    outstandingAcceptanceGates: [
      "Independent acquisition provenance",
      "Reviewed production decision",
    ],
    limitation:
      "Local seals and source hashes do not establish that outcomes were previously unseen. Acquisition provenance and a separate reviewed decision remain required.",
  };
}

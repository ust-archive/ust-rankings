import assert from "node:assert/strict";
import { test } from "vitest";
import {
  evaluateProspective,
  type ForecastRow,
  type OutcomeRow,
} from "../src/prospective-evaluate.ts";
import type { Protocol } from "../src/prospective-seal.ts";

const instructor = "00000000-0000-4000-8000-000000000001";
const otherInstructor = "00000000-0000-4000-8000-000000000002";
const accepted = { "103": [instructor] };
const parameters = {
  timelinessBase: 0.65,
  courseInstructorMultiplier: 12,
  reviewVoteScale: 1,
  sfqRatePenalty: 1,
  contextAffectsUncertainty: true,
};
// Small thresholds exercise this pure scoring seam. The seal reader separately
// requires the exact frozen production thresholds before calling the evaluator.
const protocol: Protocol = {
  schemaVersion: 1,
  createdAt: "2026-09-07T00:00:00Z",
  knownOutcomeCeilingTerm: 103,
  firstOutcomeTerm: 104,
  inspectedSourceRevisions: ["a".repeat(40)],
  legacyManifestSha256: "a".repeat(64),
  implementationSha256: "b".repeat(64),
  candidateRegistry: [
    { id: "current", role: "control", parameters },
    {
      id: "votes-unweighted-context-4",
      role: "challenger",
      parameters: {
        ...parameters,
        courseInstructorMultiplier: 4,
        reviewVoteScale: 0,
      },
    },
  ],
  sealWhen: {
    minimumDistinctOutcomeTerms: 1,
    minimumCourseUnits: 1,
    minimumDistinctCourses: 1,
    minimumInstructorUnits: 1,
    minimumDistinctInstructors: 1,
  },
  acceptance: {
    minimumRelativePrimaryImprovement: 0.02,
    maximumRelativeRegressionInAnyPredeclaredCriterionOrSource: 0.02,
    requireCourseClusterUpper95BelowZero: true,
    requireTermBlockUpper95BelowZero: true,
  },
  intervalRule: "normal-model-plus-source-noise-v1",
  bootstrap: { replicates: 2000, seed: 167 },
  baselineRegistry: ["population", "unshrunk", "latest", "rolling"],
  coverageTargets: [0.5, 0.8, 0.9, 0.95],
  coverageAcceptanceRule: "empirical-coverage-at-least-nominal-at-each-level",
  baselineAcceptanceRule: "strictly-lower-primary-mae-than-every-baseline",
};
const challenger = "votes-unweighted-context-4";
const outcome = (
  id: string,
  overrides: Partial<OutcomeRow> = {},
): OutcomeRow => ({
  observationId: id,
  sourceRevision: "b".repeat(40),
  term: 104,
  family: "course",
  entityId: "COMP 1001",
  criterion: "course",
  source: "sfq",
  rating: 4,
  sourceStddev: null,
  samples: 10,
  weight: 10,
  ...overrides,
});
const instructorOutcome = outcome("instructor", {
  family: "instructor",
  entityId: instructor,
  criterion: "instructor",
});
const allCourseOutcomes = (
  prefix: string,
  overrides: Partial<OutcomeRow> = {},
) =>
  ["course", "content", "teaching", "grading", "workload"].map((criterion) =>
    outcome(`${prefix}-${criterion}`, {
      criterion,
      source: criterion === "course" ? "sfq" : "review",
      ...overrides,
    }),
  );
function forecastsFor(outcomes: OutcomeRow[], cutoffTerm = 103): ForecastRow[] {
  const units = new Map(
    outcomes
      .filter((row) => row.entityId !== null)
      .map((row) => [
        JSON.stringify([row.family, row.entityId, row.criterion]),
        row,
      ]),
  );
  return [...units.values()].flatMap((row) =>
    [
      ...protocol.candidateRegistry.map(({ id }) => id),
      ...protocol.baselineRegistry,
    ].map((id) => ({
      candidateId: id,
      cutoffTerm,
      family: row.family,
      entityId: row.entityId ?? "",
      criterion: row.criterion,
      prediction: row.family === "instructor" ? 4 : id === challenger ? 4 : 3,
      modelStddev: 0,
    })),
  );
}

test("minimum gates expose diagnostics without scoring outcome errors", () => {
  const empty = evaluateProspective(protocol, [], [], {});
  assert.equal(empty.status, "diagnostics-only");
  assert.equal("results" in empty, false);
  assert.equal(empty.accepted, false);
  const outcomes = [outcome("course"), instructorOutcome];
  const result = evaluateProspective(
    { ...protocol, sealWhen: { ...protocol.sealWhen, minimumCourseUnits: 2 } },
    forecastsFor(outcomes),
    outcomes,
    accepted,
  );
  assert.equal(result.status, "diagnostics-only");
  assert.equal("results" in result, false);
  assert.deepEqual(result.unmetGates, ["courseUnits"]);
});

test("averages primary unit outcomes before absolute error and keeps raw weighting secondary", () => {
  const outcomes = [
    outcome("a1", { rating: 1, weight: 1000 }),
    outcome("a2", { rating: 5 }),
    outcome("b", { entityId: "COMP 1002", rating: 3 }),
    instructorOutcome,
  ];
  const result = evaluateProspective(
    protocol,
    forecastsFor(outcomes),
    outcomes,
    accepted,
  );
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  const course = result.results.current?.course;
  assert(course);
  assert.equal(course.units, 2);
  assert.equal(course.primaryMeanAbsoluteError, 0);
  assert.equal(course.rawObservationMeanAbsoluteError, 4 / 3);
  assert(
    course.sourceWeightedMeanAbsoluteError !== null &&
      course.sourceWeightedMeanAbsoluteError > 1.9,
  );
  assert.equal(course.equalUnitSignedError, 0);
});

test("uses the latest shared cutoff and never falls back for a missing entity", () => {
  const outcomes = [
    outcome("course", { term: 105 }),
    { ...instructorOutcome, term: 105 },
  ];
  const old = forecastsFor(outcomes);
  const later = forecastsFor(
    [outcome("unrelated", { entityId: "COMP 9999" })],
    104,
  );
  const missing = evaluateProspective(
    protocol,
    [...old, ...later],
    outcomes,
    accepted,
  );
  assert.equal(missing.status, "diagnostics-only");
  assert.equal(missing.diagnostics.selectedCutoffsByOutcomeTerm[105], 104);
  assert.equal(
    missing.diagnostics.coverage.course.missingAnyCandidateForecastOutcomes,
    1,
  );
  assert.equal(missing.diagnostics.counts.courseUnits, 0);
  const newForecasts = forecastsFor(outcomes, 104).map((row) => ({
    ...row,
    prediction: 5,
  }));
  const result = evaluateProspective(
    protocol,
    [...old, ...newForecasts],
    outcomes,
    { ...accepted, "104": [instructor] },
  );
  assert.equal(result.status, "evaluated");
  if (result.status === "evaluated")
    assert.equal(result.results.current?.course.primaryMeanAbsoluteError, 1);
  assert.throws(
    () =>
      evaluateProspective(
        protocol,
        [...old, later[0] as ForecastRow],
        outcomes,
        accepted,
      ),
    /complete candidate set/,
  );
});

test("Instructor primary units average paired outcomes before measuring error", () => {
  const rows = [
    outcome("course"),
    { ...instructorOutcome, rating: 1 },
    { ...instructorOutcome, observationId: "second-instructor", rating: 5 },
  ];
  const forecasts = forecastsFor(rows).map((row) =>
    row.family === "instructor" ? { ...row, prediction: 3 } : row,
  );
  const result = evaluateProspective(protocol, forecasts, rows, accepted);
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  assert.equal(result.results.current?.instructor.primaryMeanAbsoluteError, 0);
  assert.equal(
    result.results.current?.instructor.rawObservationMeanAbsoluteError,
    2,
  );
  assert.equal(
    result.comparisons[0]?.instructorIntervals.instructorCluster.estimate,
    0,
  );
});

test("unpaired candidate eligibility blocks scoring and counts missing coverage", () => {
  const outcomes = [
    outcome("a"),
    outcome("b", { entityId: "COMP 1002" }),
    instructorOutcome,
  ];
  const forecasts = forecastsFor(outcomes).filter(
    (row) => !(row.candidateId === challenger && row.entityId === "COMP 1002"),
  );
  const result = evaluateProspective(protocol, forecasts, outcomes, accepted);
  assert.equal(result.status, "diagnostics-only");
  assert.equal(result.diagnostics.gates.candidateUnitSetsIdentical, false);
  assert.equal(
    result.diagnostics.coverage.course.matchedByCandidate.current,
    2,
  );
  assert.equal(
    result.diagnostics.coverage.course.matchedByCandidate[challenger],
    1,
  );
  assert.equal(result.diagnostics.coverage.course.commonMatchedOutcomes, 1);
  assert.equal("results" in result, false);
});

test("unknown Instructor identity and four-Term horizon remain coverage diagnostics", () => {
  const outcomes = [
    outcome("course"),
    instructorOutcome,
    outcome("unknown", {
      family: "instructor",
      criterion: "instructor",
      entityId: otherInstructor,
    }),
    outcome("old", { term: 108 }),
  ];
  const result = evaluateProspective(
    protocol,
    forecastsFor(outcomes.slice(0, 2)),
    outcomes,
    accepted,
  );
  assert.equal(
    result.diagnostics.coverage.instructor.unknownIdentityOutcomes,
    1,
  );
  assert.equal(result.diagnostics.coverage.course.outsideHorizonOutcomes, 1);
  assert.equal(result.diagnostics.counts.instructorUnits, 1);
});

test("rejects duplicate, known, invalid, and role-mismatched evidence", () => {
  const rows = [outcome("course"), instructorOutcome];
  const forecasts = forecastsFor(rows);
  assert.throws(
    () =>
      evaluateProspective(
        protocol,
        [...forecasts, forecasts[0] as ForecastRow],
        rows,
        accepted,
      ),
    /Duplicate forecast/,
  );
  assert.throws(
    () =>
      evaluateProspective(
        protocol,
        forecasts,
        [...rows, rows[0] as OutcomeRow],
        accepted,
      ),
    /Duplicate outcome/,
  );
  assert.throws(
    () =>
      evaluateProspective(
        protocol,
        forecasts,
        [...rows, outcome("course", { sourceRevision: "c".repeat(40) })],
        accepted,
      ),
    /Duplicate outcome/,
  );
  for (const changed of [
    { sourceRevision: "a".repeat(40) },
    { sourceRevision: "main" },
    { sourceRevision: "B".repeat(40) },
    { term: 103 },
    { rating: NaN },
    { rating: Infinity },
    { weight: 0 },
    { samples: -1 },
    { sourceStddev: -0.1 },
    { criterion: "instructor" },
    { source: "review" },
  ])
    assert.throws(() =>
      evaluateProspective(
        protocol,
        forecasts,
        [outcome("invalid", changed), instructorOutcome],
        accepted,
      ),
    );
  assert.throws(
    () =>
      evaluateProspective(
        protocol,
        forecasts.map((row) => ({ ...row, modelStddev: Infinity })),
        rows,
        accepted,
      ),
    /standard deviation/,
  );
  assert.throws(
    () =>
      evaluateProspective(protocol, forecasts, rows, {
        "103": ["display name"],
      }),
    /UUID/,
  );
});

test("interval coverage keeps inverse-weight noise when source deviation is missing", () => {
  const rows = [
    outcome("course", { weight: 100, samples: 1 }),
    instructorOutcome,
  ];
  const forecasts = forecastsFor(rows).map((row) =>
    row.family === "course" ? { ...row, prediction: 3.9 } : row,
  );
  const result = evaluateProspective(protocol, forecasts, rows, accepted);
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  assert.deepEqual(
    result.results.current?.course.intervalCoverage.map((row) => row.coverage),
    [0, 1, 1, 1],
  );
});

test("a source/criterion regression fails guardrails despite primary improvement", () => {
  const rows = [
    outcome("sfq", { rating: 4 }),
    ...[1, 2, 3, 4].map((number) =>
      outcome(`review-${number}`, {
        entityId: `COMP 100${number}`,
        source: "review",
        criterion: "content",
        rating: 4,
      }),
    ),
    instructorOutcome,
  ];
  const forecasts = forecastsFor(rows).map((row) =>
    row.family === "course" && row.criterion === "course"
      ? { ...row, prediction: row.candidateId === "current" ? 4 : 5 }
      : row,
  );
  const result = evaluateProspective(protocol, forecasts, rows, accepted);
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  const comparison = result.comparisons[0];
  assert(comparison);
  assert.equal(comparison.acceptance.primaryImprovement, true);
  assert.equal(comparison.acceptance.criterionAndSourceGuardrails, false);
  assert.equal(comparison.pointErrorGuardrailsPassed, false);
  assert.equal(
    comparison.guardrails.find((row) => row.value === "sfq")
      ?.relativeRegression,
    null,
  );
});

test("paired intervals are deterministic and passing point guards never accepts production", () => {
  const rows = [104, 105, 106, 107].flatMap((term) => [
    ...allCourseOutcomes(`course-${term}`, { term }),
    { ...instructorOutcome, observationId: `instructor-${term}`, term },
  ]);
  const forecasts = forecastsFor(rows);
  const result = evaluateProspective(protocol, forecasts, rows, accepted);
  assert.deepEqual(
    evaluateProspective(protocol, forecasts, rows, accepted),
    result,
  );
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  const comparison = result.comparisons[0];
  assert(comparison);
  assert.equal(comparison.courseCluster.upper95, -1);
  assert.equal(comparison.termBlock.upper95, -1);
  assert.equal(comparison.termBlock.clusters, 4);
  assert.equal(comparison.pointErrorGuardrailsPassed, true);
  assert.equal(comparison.instructorImprovementClaim, false);
  assert.equal(result.accepted, false);
  assert.equal(result.productionPromotion, false);
  assert.equal(result.outstandingAcceptanceGates.length, 2);
  assert.equal(comparison.baselineGatePassed, true);
  assert.equal(comparison.coverageGatePassed, true);
  assert.equal(comparison.frozenMetricGatesPassed, true);
});

test("a tied simple baseline blocks the frozen gates even when current is beaten", () => {
  const rows = [...allCourseOutcomes("course"), instructorOutcome];
  const forecasts = forecastsFor(rows).map((row) =>
    row.candidateId === "rolling" ? { ...row, prediction: 4 } : row,
  );
  const result = evaluateProspective(protocol, forecasts, rows, accepted);
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  const comparison = result.comparisons[0];
  assert(comparison);
  assert.equal(comparison.pointErrorGuardrailsPassed, true);
  assert.equal(comparison.baselineGatePassed, false);
  assert.equal(comparison.frozenMetricGatesPassed, false);
  assert.equal(
    comparison.baselineComparisons.find((row) => row.baselineId === "rolling")
      ?.passed,
    false,
  );
  assert.throws(
    () =>
      evaluateProspective(
        protocol,
        forecasts.filter((row) => row.candidateId !== "rolling"),
        rows,
        accepted,
      ),
    /complete candidate set/,
  );
});

test("undercoverage fails its predeclared gate despite point and baseline improvements", () => {
  const rows = [
    ...allCourseOutcomes("course", { weight: 100 }),
    instructorOutcome,
  ];
  const forecasts = forecastsFor(rows).map((row) =>
    row.family === "course" && row.candidateId === challenger
      ? { ...row, prediction: 3.9 }
      : row,
  );
  const result = evaluateProspective(protocol, forecasts, rows, accepted);
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  const comparison = result.comparisons[0];
  assert(comparison);
  assert.equal(comparison.pointErrorGuardrailsPassed, true);
  assert.equal(comparison.baselineGatePassed, true);
  assert.equal(comparison.coverageGatePassed, false);
  assert.equal(comparison.frozenMetricGatesPassed, false);
  assert.equal(result.accepted, false);
});

test("missing predeclared outcome strata cannot pass the regression guardrails", () => {
  const rows = [outcome("course"), instructorOutcome];
  const result = evaluateProspective(
    protocol,
    forecastsFor(rows),
    rows,
    accepted,
  );
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  const comparison = result.comparisons[0];
  assert(comparison);
  assert.equal(comparison.acceptance.primaryImprovement, true);
  assert.equal(comparison.pointErrorGuardrailsPassed, false);
  assert.equal(
    comparison.guardrails.find((row) => row.value === "review")?.assessed,
    false,
  );
  assert.equal(
    comparison.guardrails.find((row) => row.value === "teaching")?.passed,
    false,
  );
});

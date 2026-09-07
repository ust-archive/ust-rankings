import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import {
  type BacktestAnalysisSummary,
  pairedBacktestIntervals,
  summarizeBacktestAnalysis,
} from "./backtest-analysis-report.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previousGeneration = process.env.RANKINGS_PREVIOUS_GENERATION_DIR;
const localDataDir = process.env.DATA_DIR;
const sfqComparabilityEvidencePath =
  process.env.RANKINGS_SFQ_COMPARABILITY_EVIDENCE;
const revisionNames = [
  "CATALOG_REVISION",
  "SCHEDULE_REVISION",
  "REVIEWS_REVISION",
  "SFQ_REVISION",
] as const;
if (!previousGeneration)
  throw new Error("RANKINGS_PREVIOUS_GENERATION_DIR is required");
if (!sfqComparabilityEvidencePath)
  throw new Error("RANKINGS_SFQ_COMPARABILITY_EVIDENCE is required");
if (
  !localDataDir &&
  revisionNames.some((name) => !/^[0-9a-f]{40}$/.test(process.env[name] ?? ""))
)
  throw new Error(
    "Backtests require DATA_DIR or immutable 40-character Catalog, Schedule, Reviews, and SFQ commits",
  );

const sfqComparabilityEvidenceBytes = await readFile(
  resolve(sfqComparabilityEvidencePath),
);
let sfqComparabilityRecord: unknown;
try {
  sfqComparabilityRecord = JSON.parse(sfqComparabilityEvidenceBytes.toString());
} catch {
  throw new Error("SFQ comparability evidence must be valid JSON");
}
if (
  !sfqComparabilityRecord ||
  typeof sfqComparabilityRecord !== "object" ||
  !("schemaVersion" in sfqComparabilityRecord) ||
  sfqComparabilityRecord.schemaVersion !== 1 ||
  !("conclusion" in sfqComparabilityRecord) ||
  sfqComparabilityRecord.conclusion !== "comparable" ||
  !("ratingScale" in sfqComparabilityRecord) ||
  sfqComparabilityRecord.ratingScale !== "1-5" ||
  !("basis" in sfqComparabilityRecord) ||
  typeof sfqComparabilityRecord.basis !== "string" ||
  !sfqComparabilityRecord.basis.trim() ||
  !("sourceVersions" in sfqComparabilityRecord) ||
  !Array.isArray(sfqComparabilityRecord.sourceVersions) ||
  sfqComparabilityRecord.sourceVersions.length < 2 ||
  sfqComparabilityRecord.sourceVersions.some(
    (version) => typeof version !== "string" || !version.trim(),
  ) ||
  new Set(sfqComparabilityRecord.sourceVersions).size !==
    sfqComparabilityRecord.sourceVersions.length
)
  throw new Error(
    "SFQ comparability evidence must establish one 1-5 scale across at least two source versions",
  );
const sfqSourceVersions = sfqComparabilityRecord.sourceVersions as string[];
if (
  !localDataDir &&
  !sfqSourceVersions.includes(process.env.SFQ_REVISION as string)
)
  throw new Error(
    "SFQ comparability evidence does not cover the selected SFQ revision",
  );
const sfqComparabilityEvidenceSha256 = createHash("sha256")
  .update(sfqComparabilityEvidenceBytes)
  .digest("hex");

const localSourceFiles = [
  "catalog/courses.parquet",
  "schedule/classes.parquet",
  "schedule/courses.parquet",
  "schedule/canonical/class_records.parquet",
  "schedule/canonical/course_records.parquet",
  "ust-space/reviews.parquet",
  "sfq/canonical/instructor_records.parquet",
  "sfq/canonical/section_records.parquet",
] as const;

type Candidate = {
  id: string;
  timelinessBase: number;
  courseInstructorMultiplier: number;
  reviewVoteScale: number;
  sfqRatePenalty: number;
  contextAffectsUncertainty: boolean;
};

const candidates: readonly Candidate[] = [
  {
    id: "current",
    timelinessBase: 0.65,
    courseInstructorMultiplier: 12,
    reviewVoteScale: 1,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: true,
  },
  {
    id: "decay-0.50",
    timelinessBase: 0.5,
    courseInstructorMultiplier: 12,
    reviewVoteScale: 1,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: true,
  },
  {
    id: "decay-0.80",
    timelinessBase: 0.8,
    courseInstructorMultiplier: 12,
    reviewVoteScale: 1,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: true,
  },
  {
    id: "context-1",
    timelinessBase: 0.65,
    courseInstructorMultiplier: 1,
    reviewVoteScale: 1,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: true,
  },
  {
    id: "context-6",
    timelinessBase: 0.65,
    courseInstructorMultiplier: 6,
    reviewVoteScale: 1,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: true,
  },
  {
    id: "votes-unweighted",
    timelinessBase: 0.65,
    courseInstructorMultiplier: 12,
    reviewVoteScale: 0,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: true,
  },
  {
    id: "votes-unweighted-context-4",
    timelinessBase: 0.65,
    courseInstructorMultiplier: 4,
    reviewVoteScale: 0,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: true,
  },
  {
    id: "sfq-response-count",
    timelinessBase: 0.65,
    courseInstructorMultiplier: 12,
    reviewVoteScale: 1,
    sfqRatePenalty: 0,
    contextAffectsUncertainty: true,
  },
  {
    id: "separate-context-uncertainty",
    timelinessBase: 0.65,
    courseInstructorMultiplier: 12,
    reviewVoteScale: 1,
    sfqRatePenalty: 1,
    contextAffectsUncertainty: false,
  },
];

const initialCandidate = candidates[0];
if (!initialCandidate) throw new Error("Current model was not evaluated");

type MetricRow = Record<string, number | bigint | null>;

async function metrics(
  connection: DuckDBConnection,
  rowsPath: string,
  ratingsPath: string,
) {
  const escapeSqlPath = (value: string) =>
    value.replaceAll("\\", "/").replaceAll("'", "''");
  const cutoffRows = (
    await connection.runAndReadAll(`
        WITH comparisons AS (
          SELECT *, min(cumulative_samples) OVER (PARTITION BY cutoff_term)
            AS minimum_samples
          FROM read_parquet('${escapeSqlPath(rowsPath)}')
        )
        SELECT
          cutoff_term::INTEGER AS cutoff_term,
          count(*)::INTEGER AS comparisons,
          avg(abs(prediction - outcome)) AS prediction_error,
          abs(avg(CASE
            WHEN outcome BETWEEN prediction - 1.96 * predictive_stddev
              AND prediction + 1.96 * predictive_stddev
            THEN 1 ELSE 0
          END) - 0.95) AS uncertainty_calibration_error,
          count(DISTINCT cumulative_samples)::INTEGER AS evidence_levels,
          abs(
            avg(abs(prediction - outcome))
              FILTER (WHERE cumulative_samples = minimum_samples)
            - avg(abs(prediction - outcome))
          ) AS sparse_evidence_sensitivity
        FROM comparisons
        GROUP BY cutoff_term
        ORDER BY cutoff_term
      `)
  ).getRowObjectsJS() as MetricRow[];
  const criterionRows = (
    await connection.runAndReadAll(`
        SELECT criterion, count(DISTINCT cutoff_term)::INTEGER AS cutoffs
        FROM read_parquet('${escapeSqlPath(rowsPath)}')
        GROUP BY criterion
      `)
  ).getRowObjectsJS() as Array<MetricRow & { criterion: string }>;
  if (
    criterionRows.some((row) => Number(row.cutoffs) < 2) ||
    criterionRows.length < 6
  )
    throw new Error(
      "Every criterion requires outcomes across multiple cutoffs",
    );

  const stabilityRows = (
    await connection.runAndReadAll(`
        WITH courses AS (
          SELECT
            subject AS prefix,
            code AS number,
            term_num,
            criterion,
            bayesian
          FROM read_parquet('${escapeSqlPath(ratingsPath)}')
          WHERE is_offered
        ), ranked AS (
          SELECT
            concat_ws(chr(31), prefix, number) AS course_id,
            term_num,
            criterion,
            (rank() OVER (
              PARTITION BY term_num, criterion
              ORDER BY bayesian DESC
            ) - 1)::DOUBLE / greatest(
              count(*) OVER (PARTITION BY term_num, criterion) - 1,
              1
            ) AS position
          FROM courses
        )
        SELECT
          current.term_num::INTEGER AS cutoff_term,
          avg(abs(current.position - prior.position)) AS ranking_stability
        FROM ranked AS current
        JOIN ranked AS prior
          ON prior.course_id = current.course_id
         AND prior.criterion = current.criterion
         AND prior.term_num = current.term_num - 1
        GROUP BY current.term_num
      `)
  ).getRowObjectsJS() as MetricRow[];
  const stability = new Map(
    stabilityRows.map((row) => [
      Number(row.cutoff_term),
      Number(row.ranking_stability),
    ]),
  );
  const cutoffs = cutoffRows.map((row) => {
    if (row.uncertainty_calibration_error === null)
      throw new Error("Every cutoff requires later outcomes");
    if (Number(row.evidence_levels) < 2)
      throw new Error("Every cutoff requires sparse and denser evidence");
    return {
      termNumber: Number(row.cutoff_term),
      comparisons: Number(row.comparisons),
      predictionError: Number(row.prediction_error),
      rankingStability: stability.get(Number(row.cutoff_term)) ?? null,
      uncertaintyCalibrationError: Number(row.uncertainty_calibration_error),
      sparseEvidenceSensitivity:
        row.sparse_evidence_sensitivity === null
          ? null
          : Number(row.sparse_evidence_sensitivity),
    };
  });
  if (cutoffs.length < 2)
    throw new Error(
      "Backtest requires future evidence for at least two cutoff Terms",
    );
  const average = (values: number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;
  const sparseValues = cutoffs.flatMap((row) =>
    row.sparseEvidenceSensitivity === null
      ? []
      : [row.sparseEvidenceSensitivity],
  );
  if (!sparseValues.length)
    throw new Error("Backtest requires both sparse and dense evidence");
  const stabilityValues = cutoffs.flatMap((row) =>
    row.rankingStability === null ? [] : [row.rankingStability],
  );
  if (!stabilityValues.length)
    throw new Error("Backtest requires consecutive cutoff Terms");
  return {
    cutoffs,
    criterionCutoffs: Object.fromEntries(
      criterionRows.map((row) => [row.criterion, Number(row.cutoffs)]),
    ),
    predictionError: average(cutoffs.map((row) => row.predictionError)),
    rankingStability: average(stabilityValues),
    uncertaintyCalibrationError: average(
      cutoffs.map((row) => row.uncertaintyCalibrationError),
    ),
    sparseEvidenceSensitivity: average(sparseValues),
  };
}

type CandidateResult = Awaited<ReturnType<typeof metrics>> & {
  id: string;
  parameters: Omit<Candidate, "id">;
  analysis: BacktestAnalysisSummary;
};

const temp = await mkdtemp(join(tmpdir(), "ust-ranking-backtest-"));
let metricsInstance: DuckDBInstance | undefined;
let metricsConnection: DuckDBConnection | undefined;
try {
  const result = spawnSync(process.execPath, [join(root, "src", "run.ts")], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      RANKINGS_OUTPUT_DIR: join(temp, "output"),
      RANKINGS_BACKTEST_DIRECTORY: temp,
      RANKINGS_BACKTEST_CANDIDATES: JSON.stringify(candidates),
      RANKINGS_TIMELINESS_BASE: String(initialCandidate.timelinessBase),
      RANKINGS_COURSE_INSTRUCTOR_MULTIPLIER: String(
        initialCandidate.courseInstructorMultiplier,
      ),
      RANKINGS_REVIEW_VOTE_SCALE: String(initialCandidate.reviewVoteScale),
      RANKINGS_SFQ_RATE_PENALTY: String(initialCandidate.sfqRatePenalty),
      RANKINGS_CONTEXT_AFFECTS_UNCERTAINTY: String(
        initialCandidate.contextAffectsUncertainty,
      ),
    },
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || "Backtest failed");
  metricsInstance = await DuckDBInstance.create(":memory:");
  metricsConnection = await metricsInstance.connect();
  const results: CandidateResult[] = [];
  for (const candidate of candidates) {
    const directory = join(temp, candidate.id);
    const rowsPath = join(directory, "comparisons.parquet");
    results.push({
      id: candidate.id,
      parameters: {
        timelinessBase: candidate.timelinessBase,
        courseInstructorMultiplier: candidate.courseInstructorMultiplier,
        reviewVoteScale: candidate.reviewVoteScale,
        sfqRatePenalty: candidate.sfqRatePenalty,
        contextAffectsUncertainty: candidate.contextAffectsUncertainty,
      },
      ...(await metrics(
        metricsConnection as DuckDBConnection,
        rowsPath,
        join(directory, "course-ratings.parquet"),
      )),
      analysis: await summarizeBacktestAnalysis(
        metricsConnection as DuckDBConnection,
        directory,
      ),
    });
  }

  const baseline = results[0];
  if (!baseline) throw new Error("Current model was not evaluated");
  const maximumAllowedCutoffPredictionRegression = 0.02;
  const maximumCutoffPredictionRegression = (candidate: CandidateResult) =>
    candidate.cutoffs.reduce((maximum, cutoff, index) => {
      const current = baseline.cutoffs[index];
      return current
        ? Math.max(
            maximum,
            cutoff.predictionError / current.predictionError - 1,
          )
        : maximum;
    }, 0);
  const reportedResults = await Promise.all(
    results.map(async (candidate) => ({
      ...candidate,
      maximumCutoffPredictionRegression:
        maximumCutoffPredictionRegression(candidate),
      pairedIntervals:
        candidate.id === baseline.id
          ? null
          : await pairedBacktestIntervals(
              metricsConnection as DuckDBConnection,
              join(temp, baseline.id),
              join(temp, candidate.id),
            ),
    })),
  );
  const winner = reportedResults
    .slice(1)
    .sort((left, right) => left.predictionError - right.predictionError)
    .find((candidate) => {
      const cutoffWins = candidate.cutoffs.filter((cutoff, index) => {
        const current = baseline.cutoffs[index];
        return current && cutoff.predictionError < current.predictionError;
      }).length;
      const sparseOkay =
        candidate.sparseEvidenceSensitivity <=
        baseline.sparseEvidenceSensitivity * 1.02;
      return (
        candidate.predictionError <= baseline.predictionError * 0.98 &&
        cutoffWins > candidate.cutoffs.length / 2 &&
        candidate.rankingStability <= baseline.rankingStability * 1.02 &&
        candidate.uncertaintyCalibrationError <=
          baseline.uncertaintyCalibrationError * 1.02 &&
        candidate.maximumCutoffPredictionRegression <=
          maximumAllowedCutoffPredictionRegression &&
        sparseOkay
      );
    });
  const selected = winner ?? baseline;
  const report = {
    generatedAt: new Date().toISOString(),
    historyMode: "retrospective",
    asOfAvailable: false,
    asOfLimitation:
      "The current source snapshots do not contain complete historical versions, votes, edits, and withdrawals for each cutoff.",
    evaluationPopulation:
      "Courses with later evidence in the following four Terms",
    sources: localDataDir
      ? {
          mode: "local",
          files: Object.fromEntries(
            await Promise.all(
              localSourceFiles.map(async (file) => [
                file,
                createHash("sha256")
                  .update(await readFile(resolve(localDataDir, file)))
                  .digest("hex"),
              ]),
            ),
          ),
        }
      : {
          mode: "remote",
          revisions: Object.fromEntries(
            revisionNames.map((name) => [name, process.env[name]]),
          ),
        },
    predictionScale: "source-rating",
    analysis: {
      usedForCandidateSelection: false,
      primaryCourseMetric:
        "Equal Course Code × outcome Term × criterion mean absolute error",
      primaryInstructorMetric:
        "Equal Instructor UUID × outcome Term mean absolute error",
      evaluationWeight:
        "Each aggregated Course or Instructor outcome unit has equal primary weight. Source weights affect fitting and the named secondary metric only.",
      intervals:
        "Deterministic paired 95% intervals resample Courses, Instructors, or outcome Terms with seed 100 and 2,000 draws.",
    },
    uncertaintyTarget: "future-observation",
    uncertaintyCriteria: [
      "content",
      "teaching",
      "grading",
      "workload",
      "course",
      "instructor",
    ],
    sfqStandardDeviationsUsed: false,
    sfqRespondentCountsUsedAsMeasurementError: true,
    sfqUncertaintyCalibrationAvailable: true,
    sfqComparabilityEstablished: true,
    sfqComparabilityEvidence: {
      sha256: sfqComparabilityEvidenceSha256,
      sourceVersions: sfqSourceVersions,
    },
    sfqComparability:
      "The supplied, hashed comparability evidence was required before respondent counts were used for confidence and interval calibration.",
    selectionGuardrails: {
      maximumCutoffPredictionRegression:
        maximumAllowedCutoffPredictionRegression,
    },
    candidates: reportedResults,
    selected: {
      id: selected.id,
      parameters: selected.parameters,
      uncertaintySemantics: selected.parameters.contextAffectsUncertainty
        ? "Course context affects both weighting and statistical confidence"
        : "Course context affects weighting but not statistical confidence",
      reason: winner
        ? "Selected after repeatable prediction improvement without material regression in stability, calibration, or sparse evidence."
        : "Kept the current model because no candidate cleared the repeatable-improvement threshold.",
    },
  };
  const output = resolve(
    process.env.RANKINGS_BACKTEST_OUTPUT ??
      join(root, "out", "model-validation.json"),
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${output}`);
} finally {
  metricsConnection?.closeSync();
  metricsInstance?.closeSync();
  await rm(temp, { recursive: true, force: true });
}

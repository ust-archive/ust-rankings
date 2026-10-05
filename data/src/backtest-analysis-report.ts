import { join, resolve } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { BacktestInvariantReport } from "./backtest-analysis.ts";

const sqlPath = (value: string) => resolve(value).replaceAll("\\", "/");

type NumberRow = Record<string, number | bigint | string | null>;

type ErrorSummary = {
  evaluationUnits: number;
  entities: number;
  predictionError: number;
  signedError: number;
  equalEntityError: number;
  rawObservationError: number;
  sourceWeightedError: number;
  respondentWeightedError: number;
  baselines: {
    unshrunk: number;
    population: number;
    latest: number;
    rolling: number;
    courseOnly?: number | null;
  };
};

export type BacktestAnalysisSummary = {
  course: ErrorSummary & {
    criteria: number;
    criterionMismatches: number;
    equalCriterionError: number;
  };
  instructor: ErrorSummary & {
    teamTaughtError: number | null;
    soloError: number | null;
    coldInstructorError: number | null;
    multiCourseInstructorError: number | null;
  };
  context: BacktestInvariantReport & {
    observations: number;
    classContexts: number;
    missingClassContexts: number;
    teamAllocations: number;
    unallocatedSharedEvidence: number;
    maximumAllocationSumError: number;
  };
};

export type PairedInterval = {
  estimate: number;
  lower95: number;
  upper95: number;
  probabilityOfImprovement: number;
  clusters: number;
};

const parquet = (directory: string, name: string) =>
  sqlPath(join(directory, name)).replaceAll("'", "''");

const number = (value: number | bigint | string | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

async function queryRows(
  connection: DuckDBConnection,
  sql: string,
): Promise<NumberRow[]> {
  return (await connection.runAndReadAll(sql)).getRowObjectsJS() as NumberRow[];
}

export async function summarizeBacktestAnalysis(
  connection: DuckDBConnection,
  directory: string,
): Promise<BacktestAnalysisSummary> {
  const coursePath = parquet(directory, "course-analysis.parquet");
  const instructorPath = parquet(directory, "instructor-analysis.parquet");
  const contextPath = parquet(directory, "evidence-context.parquet");
  const allocationPath = parquet(directory, "evidence-allocations.parquet");
  const [course] = await queryRows(
    connection,
    `
      WITH raw AS (
        SELECT * FROM read_parquet('${coursePath}')
      ), unit_cutoffs AS (
        SELECT
          course_id,
          cutoff_term,
          outcome_term,
          criterion,
          min(prediction) AS prediction,
          min(unshrunk_prediction) AS unshrunk_prediction,
          min(population_prediction) AS population_prediction,
          min(latest_prediction) AS latest_prediction,
          min(rolling_prediction) AS rolling_prediction,
          avg(outcome) AS outcome
        FROM raw
        GROUP BY course_id, cutoff_term, outcome_term, criterion
      ), units AS (
        SELECT
          course_id,
          outcome_term,
          criterion,
          avg(abs(prediction - outcome)) AS prediction_error,
          avg(prediction - outcome) AS signed_error,
          avg(abs(unshrunk_prediction - outcome)) AS unshrunk_error,
          avg(abs(population_prediction - outcome)) AS population_error,
          avg(abs(latest_prediction - outcome)) AS latest_error,
          avg(abs(rolling_prediction - outcome)) AS rolling_error
        FROM unit_cutoffs
        GROUP BY course_id, outcome_term, criterion
      ), entity_errors AS (
        SELECT course_id, avg(prediction_error) AS error
        FROM units GROUP BY course_id
      ), criterion_errors AS (
        SELECT criterion, avg(prediction_error) AS error
        FROM units GROUP BY criterion
      )
      SELECT
        (SELECT count(*) FROM units)::INTEGER AS evaluation_units,
        (SELECT count(DISTINCT course_id) FROM units)::INTEGER AS entities,
        (SELECT count(DISTINCT criterion) FROM units)::INTEGER AS criteria,
        (SELECT count(*) FROM raw WHERE criterion <> outcome_criterion)::INTEGER
          AS criterion_mismatches,
        avg(prediction_error) AS prediction_error,
        avg(signed_error) AS signed_error,
        (SELECT avg(error) FROM entity_errors) AS equal_entity_error,
        (SELECT avg(error) FROM criterion_errors) AS equal_criterion_error,
        (SELECT avg(abs(prediction - outcome)) FROM raw)
          AS raw_observation_error,
        (SELECT sum(outcome_weight * abs(prediction - outcome))
          / nullif(sum(outcome_weight), 0) FROM raw)
          AS source_weighted_error,
        (SELECT sum(outcome_samples * abs(prediction - outcome))
          / nullif(sum(outcome_samples), 0) FROM raw)
          AS respondent_weighted_error,
        avg(unshrunk_error) AS unshrunk_error,
        avg(population_error) AS population_error,
        avg(latest_error) AS latest_error,
        avg(rolling_error) AS rolling_error
      FROM units
    `,
  );
  const [instructor] = await queryRows(
    connection,
    `
      WITH raw AS (
        SELECT * FROM read_parquet('${instructorPath}')
      ), unit_cutoffs AS (
        SELECT
          uuid,
          cutoff_term,
          outcome_term,
          min(prediction) AS prediction,
          min(unshrunk_prediction) AS unshrunk_prediction,
          min(population_prediction) AS population_prediction,
          min(latest_prediction) AS latest_prediction,
          min(rolling_prediction) AS rolling_prediction,
          avg(course_prediction) AS course_prediction,
          avg(outcome) AS outcome
        FROM raw
        GROUP BY uuid, cutoff_term, outcome_term
      ), units AS (
        SELECT
          uuid,
          outcome_term,
          avg(abs(prediction - outcome)) AS prediction_error,
          avg(prediction - outcome) AS signed_error,
          avg(abs(unshrunk_prediction - outcome)) AS unshrunk_error,
          avg(abs(population_prediction - outcome)) AS population_error,
          avg(abs(latest_prediction - outcome)) AS latest_error,
          avg(abs(rolling_prediction - outcome)) AS rolling_error,
          avg(abs(course_prediction - outcome))
            FILTER (WHERE course_prediction IS NOT NULL) AS course_only_error
        FROM unit_cutoffs
        GROUP BY uuid, outcome_term
      ), entity_errors AS (
        SELECT uuid, avg(prediction_error) AS error
        FROM units GROUP BY uuid
      )
      SELECT
        (SELECT count(*) FROM units)::INTEGER AS evaluation_units,
        (SELECT count(DISTINCT uuid) FROM units)::INTEGER AS entities,
        avg(prediction_error) AS prediction_error,
        avg(signed_error) AS signed_error,
        (SELECT avg(error) FROM entity_errors) AS equal_entity_error,
        (SELECT avg(abs(prediction - outcome)) FROM raw)
          AS raw_observation_error,
        (SELECT sum(outcome_weight * abs(prediction - outcome))
          / nullif(sum(outcome_weight), 0) FROM raw)
          AS source_weighted_error,
        (SELECT sum(outcome_samples * abs(prediction - outcome))
          / nullif(sum(outcome_samples), 0) FROM raw)
          AS respondent_weighted_error,
        avg(unshrunk_error) AS unshrunk_error,
        avg(population_error) AS population_error,
        avg(latest_error) AS latest_error,
        avg(rolling_error) AS rolling_error,
        avg(course_only_error) AS course_only_error,
        (SELECT avg(abs(prediction - outcome)) FROM raw WHERE team_taught)
          AS team_taught_error,
        (SELECT avg(abs(prediction - outcome)) FROM raw WHERE NOT team_taught)
          AS solo_error,
        (SELECT avg(abs(prediction - outcome)) FROM raw WHERE cold_instructor)
          AS cold_instructor_error,
        (SELECT avg(abs(prediction - outcome)) FROM raw
          WHERE historical_courses > 1) AS multi_course_instructor_error
      FROM units
    `,
  );
  const [context] = await queryRows(
    connection,
    `
      WITH contexts AS (
        SELECT * FROM read_parquet('${contextPath}')
      ), allocations AS (
        SELECT * FROM read_parquet('${allocationPath}')
      ), sums AS (
        SELECT
          observation_id,
          sum(allocation) AS allocation_sum,
          sum(allocated_samples) AS allocated_samples,
          sum(allocated_weight) AS allocated_weight
        FROM allocations GROUP BY observation_id
      )
      SELECT
        (SELECT count(*) FROM contexts)::INTEGER AS observations,
        (SELECT count(*) FROM contexts WHERE class_id IS NOT NULL)::INTEGER
          AS class_contexts,
        (SELECT count(*) FROM contexts WHERE section_id IS NOT NULL
          AND class_id IS NULL)::INTEGER AS missing_class_contexts,
        (SELECT count(*) FROM allocations WHERE team_size > 1)::INTEGER
          AS team_allocations,
        (SELECT count(*)
         FROM contexts
         LEFT JOIN allocations USING (observation_id)
         WHERE contexts.evidence_role IN ('course', 'review')
           AND allocations.observation_id IS NULL
        )::INTEGER AS unallocated_shared_evidence,
        coalesce((SELECT max(abs(allocation_sum - 1)) FROM sums), 0)
          AS maximum_allocation_sum_error,
        (SELECT count(*) FROM (
          SELECT observation_id FROM contexts GROUP BY observation_id
          HAVING count(*) <> 1
        ))::INTEGER AS duplicate_contexts,
        (SELECT count(*) FROM (
          SELECT observation_id, uuid FROM allocations
          GROUP BY observation_id, uuid HAVING count(*) <> 1
        ))::INTEGER AS duplicate_allocations,
        (SELECT count(*) FROM sums
          WHERE abs(allocation_sum - 1) > 1e-12)::INTEGER
          AS invalid_allocation_sums,
        (SELECT count(*)
         FROM sums JOIN contexts USING (observation_id)
         WHERE abs(allocated_samples - contexts.source_samples) > 1e-12
        )::INTEGER AS invalid_allocated_samples,
        (SELECT count(*)
         FROM sums JOIN contexts USING (observation_id)
         WHERE abs(allocated_weight - contexts.source_weight) > 1e-12
        )::INTEGER AS invalid_allocated_weights,
        (SELECT count(*)
         FROM contexts LEFT JOIN allocations USING (observation_id)
         WHERE contexts.evidence_role = 'instructor'
           AND allocations.observation_id IS NULL
        )::INTEGER AS missing_instructor_allocations,
        (SELECT count(*) FROM allocations
          WHERE evidence_role = 'instructor' AND team_size <> 1)::INTEGER
          AS instructor_evidence_fanout
    `,
  );
  if (!course || !instructor || !context)
    throw new Error("Backtest analysis artifacts are empty");
  const required = (value: number | bigint | string | null | undefined) => {
    const parsed = number(value);
    if (parsed === null || !Number.isFinite(parsed))
      throw new Error("Backtest analysis metric is unavailable");
    return parsed;
  };
  return {
    course: {
      evaluationUnits: required(course.evaluation_units),
      entities: required(course.entities),
      criteria: required(course.criteria),
      criterionMismatches: required(course.criterion_mismatches),
      predictionError: required(course.prediction_error),
      signedError: required(course.signed_error),
      equalEntityError: required(course.equal_entity_error),
      equalCriterionError: required(course.equal_criterion_error),
      rawObservationError: required(course.raw_observation_error),
      sourceWeightedError: required(course.source_weighted_error),
      respondentWeightedError: required(course.respondent_weighted_error),
      baselines: {
        unshrunk: required(course.unshrunk_error),
        population: required(course.population_error),
        latest: required(course.latest_error),
        rolling: required(course.rolling_error),
      },
    },
    instructor: {
      evaluationUnits: required(instructor.evaluation_units),
      entities: required(instructor.entities),
      predictionError: required(instructor.prediction_error),
      signedError: required(instructor.signed_error),
      equalEntityError: required(instructor.equal_entity_error),
      rawObservationError: required(instructor.raw_observation_error),
      sourceWeightedError: required(instructor.source_weighted_error),
      respondentWeightedError: required(instructor.respondent_weighted_error),
      baselines: {
        unshrunk: required(instructor.unshrunk_error),
        population: required(instructor.population_error),
        latest: required(instructor.latest_error),
        rolling: required(instructor.rolling_error),
        courseOnly: number(instructor.course_only_error),
      },
      teamTaughtError: number(instructor.team_taught_error),
      soloError: number(instructor.solo_error),
      coldInstructorError: number(instructor.cold_instructor_error),
      multiCourseInstructorError: number(
        instructor.multi_course_instructor_error,
      ),
    },
    context: {
      observations: required(context.observations),
      classContexts: required(context.class_contexts),
      missingClassContexts: required(context.missing_class_contexts),
      teamAllocations: required(context.team_allocations),
      unallocatedSharedEvidence: required(context.unallocated_shared_evidence),
      maximumAllocationSumError: required(context.maximum_allocation_sum_error),
      duplicateContexts: required(context.duplicate_contexts),
      duplicateAllocations: required(context.duplicate_allocations),
      invalidAllocationSums: required(context.invalid_allocation_sums),
      invalidAllocatedSamples: required(context.invalid_allocated_samples),
      invalidAllocatedWeights: required(context.invalid_allocated_weights),
      missingInstructorAllocations: required(
        context.missing_instructor_allocations,
      ),
      instructorEvidenceFanout: required(context.instructor_evidence_fanout),
    },
  };
}

function clusteredInterval(
  clusters: Array<{ errorSum: number; comparisons: number }>,
  seed = 100,
  draws = 2000,
): PairedInterval | null {
  if (!clusters.length) return null;
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const estimates: number[] = [];
  for (let draw = 0; draw < draws; draw++) {
    let errorSum = 0;
    let comparisons = 0;
    for (let index = 0; index < clusters.length; index++) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      if (!cluster) continue;
      errorSum += cluster.errorSum;
      comparisons += cluster.comparisons;
    }
    estimates.push(errorSum / comparisons);
  }
  estimates.sort((left, right) => left - right);
  return {
    estimate:
      clusters.reduce((sum, cluster) => sum + cluster.errorSum, 0) /
      clusters.reduce((sum, cluster) => sum + cluster.comparisons, 0),
    lower95: estimates[Math.floor(draws * 0.025)] ?? estimates[0] ?? 0,
    upper95: estimates[Math.ceil(draws * 0.975) - 1] ?? estimates.at(-1) ?? 0,
    probabilityOfImprovement:
      estimates.filter((estimate) => estimate < 0).length / estimates.length,
    clusters: clusters.length,
  };
}

async function pairedClusters(
  connection: DuckDBConnection,
  currentPath: string,
  candidatePath: string,
  family: "course" | "instructor",
  cluster: "entity" | "term",
): Promise<Array<{ errorSum: number; comparisons: number }>> {
  const entity = family === "course" ? "course_id" : "uuid";
  const criterion = family === "course" ? ", criterion" : "";
  const group = cluster === "entity" ? entity : "outcome_term";
  const rows = await queryRows(
    connection,
    `
      WITH current_cutoffs AS (
        SELECT
          ${entity}, cutoff_term, outcome_term${criterion},
          min(prediction) AS prediction,
          avg(outcome) AS outcome
        FROM read_parquet('${currentPath}')
        GROUP BY ${entity}, cutoff_term, outcome_term${criterion}
      ), current_units AS (
        SELECT
          ${entity}, outcome_term${criterion},
          avg(abs(prediction - outcome)) AS error
        FROM current_cutoffs
        GROUP BY ${entity}, outcome_term${criterion}
      ), candidate_cutoffs AS (
        SELECT
          ${entity}, cutoff_term, outcome_term${criterion},
          min(prediction) AS prediction,
          avg(outcome) AS outcome
        FROM read_parquet('${candidatePath}')
        GROUP BY ${entity}, cutoff_term, outcome_term${criterion}
      ), candidate_units AS (
        SELECT
          ${entity}, outcome_term${criterion},
          avg(abs(prediction - outcome)) AS error
        FROM candidate_cutoffs
        GROUP BY ${entity}, outcome_term${criterion}
      )
      SELECT
        current_units.${group} AS cluster,
        round(sum(candidate_units.error - current_units.error), 14)
          AS error_sum,
        count(*)::INTEGER AS comparisons
      FROM current_units
      JOIN candidate_units
        USING (${entity}, outcome_term${criterion})
      GROUP BY current_units.${group}
      ORDER BY current_units.${group}
    `,
  );
  return rows.map((row) => ({
    errorSum: Number(row.error_sum),
    comparisons: Number(row.comparisons),
  }));
}

export async function pairedBacktestIntervals(
  connection: DuckDBConnection,
  currentDirectory: string,
  candidateDirectory: string,
): Promise<{
  course: { byCourse: PairedInterval | null; byTerm: PairedInterval | null };
  instructor: {
    byInstructor: PairedInterval | null;
    byTerm: PairedInterval | null;
  };
}> {
  const currentCourse = parquet(currentDirectory, "course-analysis.parquet");
  const candidateCourse = parquet(
    candidateDirectory,
    "course-analysis.parquet",
  );
  const currentInstructor = parquet(
    currentDirectory,
    "instructor-analysis.parquet",
  );
  const candidateInstructor = parquet(
    candidateDirectory,
    "instructor-analysis.parquet",
  );
  const [courseEntities, courseTerms, instructorEntities, instructorTerms] =
    await Promise.all([
      pairedClusters(
        connection,
        currentCourse,
        candidateCourse,
        "course",
        "entity",
      ),
      pairedClusters(
        connection,
        currentCourse,
        candidateCourse,
        "course",
        "term",
      ),
      pairedClusters(
        connection,
        currentInstructor,
        candidateInstructor,
        "instructor",
        "entity",
      ),
      pairedClusters(
        connection,
        currentInstructor,
        candidateInstructor,
        "instructor",
        "term",
      ),
    ]);
  return {
    course: {
      byCourse: clusteredInterval(courseEntities),
      byTerm: clusteredInterval(courseTerms),
    },
    instructor: {
      byInstructor: clusteredInterval(instructorEntities),
      byTerm: clusteredInterval(instructorTerms),
    },
  };
}

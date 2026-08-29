import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";

export type BacktestInvariantReport = {
  duplicateContexts: number;
  duplicateAllocations: number;
  invalidAllocationSums: number;
  invalidAllocatedSamples: number;
  invalidAllocatedWeights: number;
  missingInstructorAllocations: number;
  instructorEvidenceFanout: number;
};

const sqlPath = (value: string) => resolve(value).replaceAll("\\", "/");

async function setPath(
  connection: DuckDBConnection,
  name: string,
  value: string,
): Promise<void> {
  await connection.run(`SET VARIABLE ${name} = $value`, {
    value: sqlPath(value),
  });
}

export async function prepareBacktestAnalysis(
  connection: DuckDBConnection,
  scheduleClassRecordsPath: string,
  scheduleCourseRecordsPath: string,
): Promise<void> {
  await setPath(
    connection,
    "backtest_schedule_class_records",
    scheduleClassRecordsPath,
  );
  await setPath(
    connection,
    "backtest_schedule_course_records",
    scheduleCourseRecordsPath,
  );
  await connection.run(`
    CREATE OR REPLACE TEMP TABLE backtest_schedule_courses AS
    WITH ranked AS (
      SELECT
        *,
        row_number() OVER (
          PARTITION BY term_num, upper(trim(prefix)), upper(trim(number))
          ORDER BY
            "timestamp" DESC NULLS LAST,
            coalesce(source_order, -1) DESC,
            CASE version WHEN 'api' THEN 0 ELSE 1 END,
            status ASC
        ) AS event_rank
      FROM read_parquet(getvariable('backtest_schedule_course_records'))
      WHERE prefix IS NOT NULL AND number IS NOT NULL
    )
    SELECT
      term_num,
      upper(trim(prefix)) AS subject,
      upper(trim(number)) AS code,
      id AS schedule_course_id,
      career::VARCHAR AS career,
      credits::DOUBLE AS credits
    FROM ranked
    WHERE event_rank = 1 AND status = 'ACTIVE';

    CREATE OR REPLACE TEMP TABLE backtest_schedule_classes AS
    WITH ranked_events AS (
      SELECT
        *,
        row_number() OVER (
          PARTITION BY
            term_num,
            upper(trim(prefix)),
            upper(trim(course_number)),
            coalesce(course_id, ''),
            coalesce(section, ''),
            number
          ORDER BY
            "timestamp" DESC NULLS LAST,
            coalesce(source_order, -1) DESC,
            CASE version WHEN 'api' THEN 0 ELSE 1 END,
            status ASC
        ) AS event_rank
      FROM read_parquet(getvariable('backtest_schedule_class_records'))
      WHERE prefix IS NOT NULL AND course_number IS NOT NULL
    ), active_classes AS (
      SELECT
        *,
        row_number() OVER (
          PARTITION BY
            term_num,
            upper(trim(prefix)),
            upper(trim(course_number)),
            coalesce(section, '')
          ORDER BY
            CASE WHEN "role" = 'E' AND "type" IN ('LEC', 'IND')
              THEN 0 ELSE 1 END,
            CASE WHEN "role" = 'E' THEN 0 ELSE 1 END,
            number,
            coalesce(course_id, '')
        ) AS section_rank
      FROM ranked_events
      WHERE event_rank = 1 AND status = 'ACTIVE'
    )
    SELECT
      term_num,
      upper(trim(prefix)) AS subject,
      upper(trim(course_number)) AS code,
      section,
      concat_ws(
        chr(31), term_num::VARCHAR,
        coalesce(course_id, upper(trim(prefix)) || ' ' || upper(trim(course_number))),
        number::VARCHAR
      ) AS schedule_class_id,
      number::INTEGER AS schedule_class_number,
      "role"::VARCHAR AS schedule_class_role,
      "type"::VARCHAR AS schedule_class_type,
      capacity,
      enroll AS enrollment,
      CASE WHEN capacity > 0 THEN enroll::DOUBLE / capacity END
        AS capacity_utilization,
      len(list_distinct(list_filter(
        flatten(list_transform(schedules, schedule -> schedule.instructors)),
        instructor -> length(trim(coalesce(instructor, ''))) > 0
      )))::INTEGER AS team_size
    FROM active_classes
    WHERE section_rank = 1;

    CREATE OR REPLACE TEMP TABLE backtest_observation_contexts AS
    SELECT
      observation_id,
      'review' AS evidence_role,
      source,
      term_num,
      subject,
      code,
      criterion,
      subject || chr(31) || code || chr(31) || term_num AS course_offering_id,
      NULL::VARCHAR AS section,
      NULL::VARCHAR AS section_id,
      NULL::VARCHAR AS class_id,
      NULL::INTEGER AS schedule_class_number,
      NULL::VARCHAR AS schedule_class_role,
      NULL::VARCHAR AS schedule_class_type,
      courses.schedule_course_id,
      courses.career,
      courses.credits,
      NULL::BIGINT AS enrollment,
      NULL::BIGINT AS capacity,
      NULL::DOUBLE AS capacity_utilization,
      NULL::INTEGER AS scheduled_team_size,
      rating,
      weight AS source_weight,
      samples AS source_samples,
      NULL::BIGINT AS invited,
      NULL::DOUBLE AS response_rate,
      NULL::DOUBLE AS source_stddev,
      NULL::VARCHAR AS acquisition_sha256
    FROM review_observations
    LEFT JOIN backtest_schedule_courses AS courses
      USING (term_num, subject, code)

    UNION ALL BY NAME

    SELECT
      observations.observation_id,
      'course' AS evidence_role,
      observations.source,
      observations.term_num,
      observations.subject,
      observations.code,
      observations.criterion,
      observations.subject || chr(31) || observations.code || chr(31)
        || observations.term_num AS course_offering_id,
      observations.section,
      observations.subject || chr(31) || observations.code || chr(31)
        || observations.term_num || chr(31) || observations.section AS section_id,
      classes.schedule_class_id AS class_id,
      classes.schedule_class_number,
      classes.schedule_class_role,
      classes.schedule_class_type,
      courses.schedule_course_id,
      courses.career,
      courses.credits,
      classes.enrollment,
      classes.capacity,
      classes.capacity_utilization,
      classes.team_size AS scheduled_team_size,
      observations.rating,
      observations.weight AS source_weight,
      observations.samples AS source_samples,
      observations.sfq_num_invites AS invited,
      observations.sfq_response_rate AS response_rate,
      observations.source_stddev,
      observations.acquisition_sha256
    FROM sfq_course_observations AS observations
    LEFT JOIN backtest_schedule_classes AS classes
      USING (term_num, subject, code, section)
    LEFT JOIN backtest_schedule_courses AS courses
      USING (term_num, subject, code)

    UNION ALL BY NAME

    SELECT
      observations.observation_id,
      'instructor' AS evidence_role,
      observations.source,
      observations.term_num,
      observations.subject,
      observations.code,
      observations.criterion,
      observations.subject || chr(31) || observations.code || chr(31)
        || observations.term_num AS course_offering_id,
      observations.section,
      observations.subject || chr(31) || observations.code || chr(31)
        || observations.term_num || chr(31) || observations.section AS section_id,
      classes.schedule_class_id AS class_id,
      classes.schedule_class_number,
      classes.schedule_class_role,
      classes.schedule_class_type,
      courses.schedule_course_id,
      courses.career,
      courses.credits,
      classes.enrollment,
      classes.capacity,
      classes.capacity_utilization,
      classes.team_size AS scheduled_team_size,
      observations.rating,
      observations.weight AS source_weight,
      observations.samples AS source_samples,
      observations.sfq_num_invites AS invited,
      observations.sfq_response_rate AS response_rate,
      observations.source_stddev,
      observations.acquisition_sha256
    FROM sfq_instructor_observations AS observations
    LEFT JOIN backtest_schedule_classes AS classes
      USING (term_num, subject, code, section)
    LEFT JOIN backtest_schedule_courses AS courses
      USING (term_num, subject, code);

    CREATE OR REPLACE TEMP TABLE backtest_observation_allocations AS
    WITH linked AS (
      SELECT DISTINCT
        contexts.observation_id,
        contexts.evidence_role,
        identities.uuid
      FROM backtest_observation_contexts AS contexts
      JOIN observation_instructor_identities AS identities
        USING (observation_id)
    ), teams AS (
      SELECT
        *,
        count(*) OVER (PARTITION BY observation_id)::INTEGER AS team_size
      FROM linked
    )
    SELECT
      teams.observation_id,
      teams.evidence_role,
      teams.uuid,
      teams.team_size,
      1.0 / teams.team_size AS allocation,
      contexts.source_samples::DOUBLE / teams.team_size AS allocated_samples,
      contexts.source_weight / teams.team_size AS allocated_weight
    FROM teams
    JOIN backtest_observation_contexts AS contexts USING (observation_id);
  `);
}

export async function backtestInvariantReport(
  connection: DuckDBConnection,
): Promise<BacktestInvariantReport> {
  const reader = await connection.runAndReadAll(`
    SELECT
      (SELECT count(*) FROM (
        SELECT observation_id
        FROM backtest_observation_contexts
        GROUP BY observation_id
        HAVING count(*) <> 1
      ))::INTEGER AS duplicate_contexts,
      (SELECT count(*) FROM (
        SELECT observation_id, uuid
        FROM backtest_observation_allocations
        GROUP BY observation_id, uuid
        HAVING count(*) <> 1
      ))::INTEGER AS duplicate_allocations,
      (SELECT count(*) FROM (
        SELECT observation_id
        FROM backtest_observation_allocations
        GROUP BY observation_id
        HAVING abs(sum(allocation) - 1) > 1e-12
      ))::INTEGER AS invalid_allocation_sums,
      (SELECT count(*) FROM (
        SELECT
          allocations.observation_id
        FROM backtest_observation_allocations AS allocations
        JOIN backtest_observation_contexts AS contexts USING (observation_id)
        GROUP BY allocations.observation_id, contexts.source_samples
        HAVING abs(sum(allocated_samples) - contexts.source_samples) > 1e-12
      ))::INTEGER AS invalid_allocated_samples,
      (SELECT count(*) FROM (
        SELECT
          allocations.observation_id
        FROM backtest_observation_allocations AS allocations
        JOIN backtest_observation_contexts AS contexts USING (observation_id)
        GROUP BY allocations.observation_id, contexts.source_weight
        HAVING abs(sum(allocated_weight) - contexts.source_weight) > 1e-12
      ))::INTEGER AS invalid_allocated_weights,
      (SELECT count(*)
       FROM backtest_observation_contexts AS contexts
       LEFT JOIN backtest_observation_allocations AS allocations
         USING (observation_id)
       WHERE contexts.evidence_role = 'instructor'
         AND allocations.observation_id IS NULL
      )::INTEGER AS missing_instructor_allocations,
      (SELECT count(*)
       FROM backtest_observation_allocations
       WHERE evidence_role = 'instructor' AND team_size <> 1
      )::INTEGER AS instructor_evidence_fanout
  `);
  const [row] = reader.getRowObjectsJson() as Array<Record<string, number>>;
  return {
    duplicateContexts: Number(row?.duplicate_contexts ?? 0),
    duplicateAllocations: Number(row?.duplicate_allocations ?? 0),
    invalidAllocationSums: Number(row?.invalid_allocation_sums ?? 0),
    invalidAllocatedSamples: Number(row?.invalid_allocated_samples ?? 0),
    invalidAllocatedWeights: Number(row?.invalid_allocated_weights ?? 0),
    missingInstructorAllocations: Number(
      row?.missing_instructor_allocations ?? 0,
    ),
    instructorEvidenceFanout: Number(row?.instructor_evidence_fanout ?? 0),
  };
}

export async function assertBacktestInvariants(
  connection: DuckDBConnection,
): Promise<BacktestInvariantReport> {
  const report = await backtestInvariantReport(connection);
  if (Object.values(report).some((count) => count !== 0))
    throw new Error(
      `Backtest evidence invariants failed: ${JSON.stringify(report)}`,
    );
  return report;
}

export async function writeBacktestAnalysis(
  connection: DuckDBConnection,
  directory: string,
): Promise<BacktestInvariantReport> {
  await mkdir(directory, { recursive: true });
  const paths = {
    contexts: join(directory, "evidence-context.parquet"),
    allocations: join(directory, "evidence-allocations.parquet"),
    courses: join(directory, "course-analysis.parquet"),
    instructors: join(directory, "instructor-analysis.parquet"),
  };
  for (const [name, value] of Object.entries(paths))
    await setPath(connection, `backtest_${name}`, value);

  const invariants = await assertBacktestInvariants(connection);
  await connection.run(`
    COPY (
      SELECT *
      FROM backtest_observation_contexts
      ORDER BY observation_id
    ) TO (getvariable('backtest_contexts'))
      (FORMAT parquet, COMPRESSION zstd);

    COPY (
      SELECT *
      FROM backtest_observation_allocations
      ORDER BY observation_id, uuid
    ) TO (getvariable('backtest_allocations'))
      (FORMAT parquet, COMPRESSION zstd);

    COPY (
      WITH predictions AS (
        SELECT
          entity_id AS course_id,
          subject,
          code,
          term_num AS cutoff_term,
          criterion,
          bayesian * stats.stddev + stats.mean AS prediction,
          rating * stats.stddev + stats.mean AS unshrunk_prediction,
          stats.mean AS population_prediction,
          stats.stddev * sqrt(pow(posterior_stddev, 2))
            AS model_stddev,
          confidence,
          reliability,
          cumulative_samples,
          effective_samples
        FROM scored_entity_ratings
        JOIN criterion_stats AS stats USING (criterion, term_num)
        WHERE family = 'course' AND stats.stddev > 0
      ), history_rows AS (
        SELECT
          predictions.course_id,
          predictions.cutoff_term,
          predictions.criterion,
          observations.term_num AS observation_term,
          observations.rating,
          max(observations.term_num) OVER (
            PARTITION BY predictions.course_id, predictions.cutoff_term,
              predictions.criterion
          ) AS latest_term
        FROM predictions
        JOIN observations
          ON observations.subject = predictions.subject
         AND observations.code = predictions.code
         AND observations.criterion = predictions.criterion
         AND observations.term_num <= predictions.cutoff_term
      ), baselines AS (
        SELECT
          course_id,
          cutoff_term,
          criterion,
          avg(rating) AS rolling_prediction,
          avg(rating) FILTER (WHERE observation_term = latest_term)
            AS latest_prediction
        FROM history_rows
        GROUP BY course_id, cutoff_term, criterion
      )
      SELECT
        predictions.course_id,
        predictions.cutoff_term,
        contexts.term_num AS outcome_term,
        predictions.criterion,
        contexts.criterion AS outcome_criterion,
        predictions.prediction,
        predictions.unshrunk_prediction,
        predictions.population_prediction,
        baselines.latest_prediction,
        baselines.rolling_prediction,
        sqrt(
          pow(predictions.model_stddev, 2)
          + pow(contexts.source_stddev, 2) / greatest(contexts.source_samples, 1)
          + 1 / greatest(contexts.source_weight, 1e-12)
        ) AS predictive_stddev,
        predictions.confidence,
        predictions.reliability,
        predictions.cumulative_samples,
        predictions.effective_samples,
        contexts.observation_id AS outcome_id,
        contexts.source AS outcome_source,
        contexts.evidence_role,
        contexts.course_offering_id,
        contexts.section_id,
        contexts.class_id,
        contexts.section,
        contexts.schedule_class_number,
        contexts.schedule_class_role,
        contexts.schedule_class_type,
        contexts.schedule_course_id,
        contexts.career,
        contexts.credits,
        contexts.enrollment,
        contexts.capacity,
        contexts.capacity_utilization,
        contexts.scheduled_team_size,
        contexts.source_weight AS outcome_weight,
        contexts.source_samples AS outcome_samples,
        contexts.rating AS outcome
      FROM predictions
      JOIN backtest_observation_contexts AS contexts
        ON contexts.subject || chr(31) || contexts.code = predictions.course_id
       AND contexts.term_num > predictions.cutoff_term
       AND contexts.term_num <= predictions.cutoff_term + 4
       AND contexts.criterion = predictions.criterion
       AND contexts.evidence_role IN ('review', 'course')
      JOIN baselines
        ON baselines.course_id = predictions.course_id
       AND baselines.cutoff_term = predictions.cutoff_term
       AND baselines.criterion = predictions.criterion
    ) TO (getvariable('backtest_courses'))
      (FORMAT parquet, COMPRESSION zstd);

    COPY (
      WITH predictions AS (
        SELECT
          entity_id AS uuid,
          term_num AS cutoff_term,
          bayesian * stats.stddev + stats.mean AS prediction,
          rating * stats.stddev + stats.mean AS unshrunk_prediction,
          stats.mean AS population_prediction,
          stats.stddev * posterior_stddev AS model_stddev,
          confidence,
          reliability,
          cumulative_samples,
          effective_samples
        FROM scored_entity_ratings
        JOIN criterion_stats AS stats USING (criterion, term_num)
        WHERE family = 'instructor'
          AND criterion = 'instructor'
          AND stats.stddev > 0
      ), outcomes AS (
        SELECT
          identities.uuid,
          contexts.*,
          observations.paired_course_rating
        FROM sfq_instructor_observations AS observations
        JOIN observation_instructor_identities AS identities
          USING (observation_id)
        JOIN backtest_observation_contexts AS contexts
          USING (observation_id)
      ), history_rows AS (
        SELECT
          predictions.uuid,
          predictions.cutoff_term,
          outcomes.term_num AS observation_term,
          outcomes.rating,
          max(outcomes.term_num) OVER (
            PARTITION BY predictions.uuid, predictions.cutoff_term
          ) AS latest_term
        FROM predictions
        JOIN outcomes
          ON outcomes.uuid = predictions.uuid
         AND outcomes.term_num <= predictions.cutoff_term
      ), baselines AS (
        SELECT
          uuid,
          cutoff_term,
          avg(rating) AS rolling_prediction,
          avg(rating) FILTER (WHERE observation_term = latest_term)
            AS latest_prediction
        FROM history_rows
        GROUP BY uuid, cutoff_term
      ), course_predictions AS (
        SELECT
          entity_id AS course_id,
          term_num AS cutoff_term,
          bayesian * stats.stddev + stats.mean AS course_prediction,
          cumulative_samples AS course_cumulative_samples
        FROM scored_entity_ratings
        JOIN criterion_stats AS stats USING (criterion, term_num)
        WHERE family = 'course'
          AND criterion = 'course'
          AND stats.stddev > 0
      ), course_counts AS (
        SELECT
          predictions.uuid,
          predictions.cutoff_term,
          count(DISTINCT contexts.subject || chr(31) || contexts.code)::INTEGER
            AS historical_courses
        FROM predictions
        LEFT JOIN observation_instructor_identities AS identities
          ON identities.uuid = predictions.uuid
        LEFT JOIN backtest_observation_contexts AS contexts
          ON contexts.observation_id = identities.observation_id
         AND contexts.term_num <= predictions.cutoff_term
        GROUP BY predictions.uuid, predictions.cutoff_term
      )
      SELECT
        predictions.uuid,
        outcomes.subject || chr(31) || outcomes.code AS course_id,
        predictions.cutoff_term,
        outcomes.term_num AS outcome_term,
        'instructor' AS criterion,
        predictions.prediction,
        predictions.unshrunk_prediction,
        predictions.population_prediction,
        coalesce(baselines.latest_prediction, predictions.population_prediction)
          AS latest_prediction,
        coalesce(baselines.rolling_prediction, predictions.population_prediction)
          AS rolling_prediction,
        course_predictions.course_prediction,
        outcomes.paired_course_rating,
        sqrt(
          pow(predictions.model_stddev, 2)
          + pow(outcomes.source_stddev, 2)
            / greatest(outcomes.source_samples, 1)
          + 1 / greatest(outcomes.source_weight, 1e-12)
        ) AS predictive_stddev,
        predictions.confidence,
        predictions.reliability,
        predictions.cumulative_samples,
        predictions.effective_samples,
        course_predictions.course_cumulative_samples,
        course_counts.historical_courses,
        predictions.cumulative_samples = 0 AS cold_instructor,
        coalesce(course_predictions.course_cumulative_samples, 0) = 0
          AS cold_course,
        CASE WHEN outcomes.scheduled_team_size IS NOT NULL
          THEN outcomes.scheduled_team_size > 1
        END AS team_taught,
        outcomes.observation_id AS outcome_id,
        outcomes.course_offering_id,
        outcomes.section_id,
        outcomes.class_id,
        outcomes.section,
        outcomes.schedule_class_number,
        outcomes.schedule_class_role,
        outcomes.schedule_class_type,
        outcomes.schedule_course_id,
        outcomes.career,
        outcomes.credits,
        outcomes.enrollment,
        outcomes.capacity,
        outcomes.capacity_utilization,
        outcomes.scheduled_team_size,
        outcomes.source_weight AS outcome_weight,
        outcomes.source_samples AS outcome_samples,
        outcomes.rating AS outcome
      FROM predictions
      JOIN outcomes
        ON outcomes.uuid = predictions.uuid
       AND outcomes.term_num > predictions.cutoff_term
       AND outcomes.term_num <= predictions.cutoff_term + 4
      LEFT JOIN baselines
        ON baselines.uuid = predictions.uuid
       AND baselines.cutoff_term = predictions.cutoff_term
      LEFT JOIN course_predictions
        ON course_predictions.course_id =
          outcomes.subject || chr(31) || outcomes.code
       AND course_predictions.cutoff_term = predictions.cutoff_term
      JOIN course_counts
        ON course_counts.uuid = predictions.uuid
       AND course_counts.cutoff_term = predictions.cutoff_term
    ) TO (getvariable('backtest_instructors'))
      (FORMAT parquet, COMPRESSION zstd);
  `);
  return invariants;
}

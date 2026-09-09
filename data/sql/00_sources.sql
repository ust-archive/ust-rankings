-- 00_sources.sql — Reconstruct the current state of each source dataset.
--
-- Inputs:  Parquet paths supplied by src/run.ts as DuckDB variables.
-- Outputs: source_schedule_classes, source_schedule_courses, source_reviews,
--          source_sfq_instructors, source_sfq_sections.
--
-- Hugging Face stores change events: an update or deletion appends a row rather
-- than overwriting the old row. For each logical key, rank all events newest
-- first, keep rank 1, and only then require ACTIVE. Filtering ACTIVE first
-- would incorrectly bring an older version of a deleted record back to life.

-- Catalog: fold each Course event stream, select the latest Term that still has
-- active Courses, and collapse equivalent cross-campus rows. The runner rejects
-- missing values or multiple metadata rows for one Course Code before export.
CREATE OR REPLACE TABLE source_catalog_courses AS
SELECT * EXCLUDE (event_rank)
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY term_num, id
      ORDER BY "timestamp" DESC, status ASC
    ) AS event_rank
  FROM read_parquet(getvariable('catalog_courses'))
)
WHERE event_rank = 1 AND status = 'ACTIVE';

CREATE OR REPLACE TABLE course_dimension AS
SELECT DISTINCT
  upper(trim(prefix)) AS prefix,
  upper(trim(number)) AS number,
  trim(title) AS title,
  attributes
FROM source_catalog_courses
WHERE term_num = (SELECT max(term_num) FROM source_catalog_courses);

-- The unified Schedule includes legacy history. Legacy rows have no Course ID
-- or role/type; L-number sections are lectures, not LA/LAX labs or tutorials.
-- Fold events before filtering ACTIVE so deletions cannot revive older rows.
CREATE OR REPLACE TABLE source_schedule_classes AS
SELECT * EXCLUDE (event_rank) REPLACE (
  CASE WHEN version = 'legacy' AND regexp_full_match(section, 'L[0-9]+[A-Z]?')
    THEN 'E' ELSE role END AS role,
  CASE WHEN version = 'legacy' AND regexp_full_match(section, 'L[0-9]+[A-Z]?')
    THEN 'LEC' ELSE type END AS type
)
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY term_num, prefix, course_number, section, number
      ORDER BY "timestamp" DESC NULLS LAST, source_order DESC NULLS LAST,
        CASE version WHEN 'api' THEN 0 ELSE 1 END, status ASC
    ) AS event_rank
  FROM read_parquet(getvariable('schedule_class_records'))
)
WHERE event_rank = 1 AND status = 'ACTIVE';

-- Course Code is the cross-version key; legacy Course IDs are absent.
CREATE OR REPLACE TABLE source_schedule_courses AS
SELECT * EXCLUDE (event_rank)
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY term_num, prefix, number
      ORDER BY "timestamp" DESC NULLS LAST, source_order DESC NULLS LAST,
        CASE version WHEN 'api' THEN 0 ELSE 1 END, status ASC
    ) AS event_rank
  FROM read_parquet(getvariable('schedule_course_records'))
)
WHERE event_rank = 1 AND status = 'ACTIVE';

-- Reviews have a stable content hash, which is their logical event-stream key.
-- PfqhaZDjE3u5fJvqPS0Gd1u5FNsJ8lnc claims LAI, Priscilla taught LANG 1402
-- in 2025-26 Fall, but no such Instructor appears anywhere in the ust-cq
-- roster history. Keep the source archive intact and exclude this false review
-- only from derived Ranking evidence.
CREATE OR REPLACE TABLE source_reviews AS
SELECT * EXCLUDE (event_rank)
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY hash
      ORDER BY "timestamp" DESC, status ASC
    ) AS event_rank
  FROM read_parquet(getvariable('reviews'))
)
WHERE event_rank = 1
  AND status = 'ACTIVE'
  AND hash <> 'PfqhaZDjE3u5fJvqPS0Gd1u5FNsJ8lnc';

-- Instructor SFQ has no single row id. The survey dimensions and measurements
-- form its semantic identity; acquisition SHA/date fields identify snapshots
-- of that same observation and therefore do not belong in the partition key.
-- One artifact may repeat the same measurement for multiple departments or
-- survey numbers. Fold its event history first, then keep that evidence once.
CREATE OR REPLACE TABLE source_sfq_instructors AS
WITH current_rows AS (
  SELECT * EXCLUDE (event_rank)
  FROM (
    SELECT
      *,
      row_number() OVER (
        PARTITION BY
          version,
          term_num,
          term_code,
          school_code,
          department_code,
          prefix,
          number,
          section,
          coalesce(instructor_name, ''),
          survey_num,
          num_invites,
          is_low_response_rate,
          response_rate,
          course_overall_mean,
          course_overall_sd,
          instructor_overall_mean,
          instructor_overall_sd
        ORDER BY
          date_of_preparation DESC,
          "timestamp" DESC,
          status ASC,
          sha256 DESC
      ) AS event_rank
    FROM read_parquet(getvariable('sfq_instructors'))
  )
  WHERE event_rank = 1 AND status = 'ACTIVE'
)
SELECT * EXCLUDE (duplicate_rank)
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY
        sha256,
        version,
        term_num,
        term_code,
        school_code,
        prefix,
        number,
        section,
        coalesce(instructor_name, ''),
        num_invites,
        is_low_response_rate,
        response_rate,
        course_overall_mean,
        course_overall_sd,
        instructor_overall_mean,
        instructor_overall_sd
      ORDER BY department_code, survey_num
    ) AS duplicate_rank
  FROM current_rows
)
WHERE duplicate_rank = 1;

-- Section SFQ is naturally one course-level observation per section. Keeping
-- this separately is what prevents a team-taught section's course score from
-- being counted once for every instructor survey.
CREATE OR REPLACE TABLE source_sfq_sections AS
WITH current_rows AS (
  SELECT * EXCLUDE (event_rank)
  FROM (
    SELECT
      *,
      row_number() OVER (
        PARTITION BY
          version,
          term_num,
          school_code,
          department_code,
          prefix,
          number,
          section
        ORDER BY
          "timestamp" DESC,
          status ASC,
          date_of_preparation DESC,
          sha256 DESC
      ) AS event_rank
    FROM read_parquet(getvariable('sfq_sections'))
  )
  WHERE event_rank = 1 AND status = 'ACTIVE'
)
SELECT * EXCLUDE (duplicate_rank)
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY
        sha256,
        version,
        term_num,
        term_code,
        school_code,
        prefix,
        number,
        section,
        num_invites,
        is_low_response_rate,
        response_rate,
        course_overall_mean,
        course_overall_sd,
        instructor_overall_mean,
        instructor_overall_sd
      ORDER BY department_code
    ) AS duplicate_rank
  FROM current_rows
)
WHERE duplicate_rank = 1;

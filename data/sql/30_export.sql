-- 30_export.sql — Write aggregate result artifacts.
--
-- Inputs:  rating marts/views and the course-instructor bridge.
-- Outputs: typed relational Parquet files for the Course dimension, rating
--          histories, current snapshots, Course-Instructor links, and identities.

-- Parquet matches the DuckDB execution model, keeps types intact, and is easy
-- to query without loading an entire result into memory. Explicit ordering
-- makes repeated builds stable and ZSTD keeps full history compact.
COPY (
  SELECT prefix, number, title, attributes
  FROM course_dimension
  ORDER BY prefix, number
) TO (getvariable('courses_parquet')) (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT
    ratings.subject,
    ratings.code,
    ratings.term_num,
    terms.term_code,
    ratings.* EXCLUDE (subject, code, term_num)
  FROM course_ratings AS ratings
  JOIN terms USING (term_num)
  ORDER BY subject, code, term_num, criterion
) TO (getvariable('course_ratings_parquet')) (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT
    ratings.name,
    ratings.term_num,
    terms.term_code,
    ratings.* EXCLUDE (name, term_num)
  FROM instructor_ratings AS ratings
  JOIN terms USING (term_num)
  ORDER BY name, term_num, criterion
) TO (getvariable('instructor_ratings_parquet')) (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT
    rankings.subject,
    rankings.code,
    rankings.term_num,
    terms.term_code,
    rankings.* EXCLUDE (subject, code, term_num)
  FROM course_rankings AS rankings
  JOIN terms USING (term_num)
  ORDER BY criterion, bayesian DESC, subject, code
) TO (getvariable('course_rankings_parquet')) (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT
    rankings.name,
    rankings.term_num,
    terms.term_code,
    rankings.* EXCLUDE (name, term_num)
  FROM instructor_rankings AS rankings
  JOIN terms USING (term_num)
  ORDER BY criterion, bayesian DESC, name
) TO (getvariable('instructor_rankings_parquet')) (FORMAT parquet, COMPRESSION zstd);

-- Course-instructor evidence is a normalized bridge. It includes historical
-- associations inferred from ratings as well as current schedule assignments.
COPY (
  SELECT
    links.name,
    links.term_num,
    terms.term_code,
    links.subject,
    links.code
  FROM course_term_instructors AS links
  JOIN terms USING (term_num)
  ORDER BY term_num, subject, code, name
) TO (getvariable('course_instructors_parquet'))
  (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT uuid, canonical_name, itsc
  FROM instructor_identities
  ORDER BY canonical_name, uuid
) TO (getvariable('instructor_identities_parquet'))
  (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT uuid, name, source, source_commit, source_file
  FROM instructor_identity_aliases
  ORDER BY uuid, name
) TO (getvariable('instructor_aliases_parquet'))
  (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT
    event_type,
    source_commit,
    uuid,
    itsc,
    retired_uuid,
    survivor_uuid,
    source_uuid,
    new_uuid
  FROM instructor_identity_events
  ORDER BY source_commit, event_type, uuid, retired_uuid, new_uuid
) TO (getvariable('instructor_identity_events_parquet'))
  (FORMAT parquet, COMPRESSION zstd);

COPY (
  SELECT source_commit, new_uuid, source_name, term_code, course_code
  FROM instructor_split_affected_associations
  ORDER BY source_commit, new_uuid, source_name
) TO (getvariable('instructor_split_affected_associations_parquet'))
  (FORMAT parquet, COMPRESSION zstd);

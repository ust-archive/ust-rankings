-- 30_export.sql — Write aggregate result artifacts.
--
-- Inputs:  rating marts/views and the course-instructor bridge.
-- Outputs: five typed, relational Parquet files: full rating histories,
--          current snapshots, and course-instructor links.

-- Parquet matches the DuckDB execution model, keeps types intact, and is easy
-- to query without loading an entire result into memory. Explicit ordering
-- makes repeated builds stable and ZSTD keeps full history compact.
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

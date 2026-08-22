-- 20_ratings.sql — Calculate historical ratings and current snapshots.
--
-- Inputs:  observations and entity/term bridges from 10_observations.sql.
-- Outputs: criterion_stats, course_ratings, instructor_ratings, and the two
--          current-term snapshot views.
--
-- Rating parameters are kept together so the model constants are visible and
-- can be evaluated by the deferred walk-forward backtest.
CREATE OR REPLACE TABLE ranking_parameters AS
SELECT
  0.65::DOUBLE AS timeliness_base,
  4::INTEGER AS timeliness_term_span,
  12::DOUBLE AS course_instructor_multiplier;

-- Rolling weighted source distributions prevent future terms from influencing
-- historical standardized scores.
CREATE OR REPLACE TABLE criterion_term_totals AS
SELECT
  criterion,
  term_num,
  sum(weight) AS weight,
  sum(weight * rating) AS weighted_rating,
  sum(weight * rating * rating) AS weighted_rating_squared
FROM observations
GROUP BY criterion, term_num;

CREATE OR REPLACE TABLE criterion_stats AS
WITH grid AS (
  SELECT criteria.criterion, terms.term_num
  FROM (SELECT DISTINCT criterion FROM observations) AS criteria
  CROSS JOIN terms
), rolling AS (
  SELECT
    grid.criterion,
    grid.term_num,
    sum(coalesce(totals.weight, 0)) OVER term_window AS weight,
    sum(coalesce(totals.weighted_rating, 0)) OVER term_window AS weighted_rating,
    sum(coalesce(totals.weighted_rating_squared, 0)) OVER term_window AS weighted_rating_squared
  FROM grid
  LEFT JOIN criterion_term_totals AS totals USING (criterion, term_num)
  WINDOW term_window AS (
    PARTITION BY grid.criterion
    ORDER BY grid.term_num
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )
), moments AS (
  SELECT
    *,
    weighted_rating / nullif(weight, 0) AS mean,
    greatest(
      weighted_rating_squared / nullif(weight, 0)
        - pow(weighted_rating / nullif(weight, 0), 2),
      0
    ) AS variance
  FROM rolling
)
SELECT
  criterion,
  term_num,
  weight,
  mean,
  CASE WHEN variance > 0 THEN sqrt(variance) END AS stddev
FROM moments;

-- Course ratings use current-term instructor overlap as a context signal.
-- Evidence at output term m from observation term n receives:
--   source_weight * 0.65 ^ ((m - n) / 4) * (12 when instructors overlap else 1)
CREATE OR REPLACE TABLE course_rating_base AS
WITH expanded AS (
  SELECT
    course_terms.subject,
    course_terms.code,
    course_terms.term_num,
    observations.criterion,
    observations.term_num AS observation_term_num,
    observations.rating,
    observations.weight,
    observations.samples,
    pow(
      parameters.timeliness_base,
      (course_terms.term_num - observations.term_num)::DOUBLE
        / parameters.timeliness_term_span
    ) AS timeliness,
    CASE WHEN EXISTS (
      SELECT 1
      FROM observation_instructor_identities AS evidence
      JOIN instructor_identity_assignments AS current
        ON current.uuid = evidence.uuid
      WHERE evidence.observation_id = observations.observation_id
        AND current.subject = course_terms.subject
        AND current.code = course_terms.code
        AND current.term_num = course_terms.term_num
    ) THEN parameters.course_instructor_multiplier ELSE 1 END AS instructor_multiplier
  FROM course_terms
  JOIN observations
    ON observations.subject = course_terms.subject
   AND observations.code = course_terms.code
   AND observations.term_num <= course_terms.term_num
  CROSS JOIN ranking_parameters AS parameters
), weighted AS (
  SELECT
    *,
    weight * timeliness * instructor_multiplier AS effective_weight
  FROM expanded
)
SELECT
  subject,
  code,
  term_num,
  criterion,
  sum(rating * effective_weight) / nullif(sum(effective_weight), 0) AS raw_rating,
  sum(effective_weight) AS confidence,
  sum(samples) FILTER (WHERE observation_term_num = term_num) AS samples,
  sum(samples) AS cumulative_samples,
  sum(samples * timeliness * instructor_multiplier) AS effective_samples
FROM weighted
GROUP BY subject, code, term_num, criterion
HAVING sum(effective_weight) > 0;

-- Instructor histories use the same time decay but no course-context multiplier.
CREATE OR REPLACE TABLE instructor_terms AS
SELECT entities.uuid, entities.name, terms.term_num
FROM resolved_instructor_entities AS entities
JOIN terms ON terms.term_num >= entities.min_term_num;

CREATE OR REPLACE TABLE instructor_rating_base AS
WITH expanded AS (
  SELECT
    instructor_terms.uuid,
    instructor_terms.name,
    instructor_terms.term_num,
    observations.criterion,
    observations.term_num AS observation_term_num,
    observations.rating,
    observations.weight,
    observations.samples,
    pow(
      parameters.timeliness_base,
      (instructor_terms.term_num - observations.term_num)::DOUBLE
        / parameters.timeliness_term_span
    ) AS timeliness
  FROM instructor_terms
  JOIN observation_instructor_identities USING (uuid)
  JOIN observations USING (observation_id)
  CROSS JOIN ranking_parameters AS parameters
  WHERE observations.term_num <= instructor_terms.term_num
), weighted AS (
  SELECT *, weight * timeliness AS effective_weight
  FROM expanded
)
SELECT
  uuid,
  name,
  term_num,
  criterion,
  sum(rating * effective_weight) / nullif(sum(effective_weight), 0) AS raw_rating,
  sum(effective_weight) AS confidence,
  sum(samples) FILTER (WHERE observation_term_num = term_num) AS samples,
  sum(samples) AS cumulative_samples,
  sum(samples * timeliness) AS effective_samples
FROM weighted
GROUP BY uuid, name, term_num, criterion
HAVING sum(effective_weight) > 0;

-- Standardization is an affine transform shared by a criterion/output term, so
-- applying it after the weighted raw mean is exactly equivalent and much smaller.
CREATE OR REPLACE TABLE entity_rating_base AS
SELECT
  'course' AS family,
  subject || chr(31) || code AS entity_id,
  subject,
  code,
  NULL::VARCHAR AS name,
  base.term_num,
  base.criterion,
  (base.raw_rating - stats.mean) / stats.stddev AS rating,
  base.confidence,
  coalesce(base.samples, 0)::BIGINT AS samples,
  base.cumulative_samples::BIGINT AS cumulative_samples,
  base.effective_samples
FROM course_rating_base AS base
JOIN criterion_stats AS stats USING (criterion, term_num)
WHERE stats.stddev > 0
UNION ALL
SELECT
  'instructor',
  base.uuid,
  NULL,
  NULL,
  base.name,
  base.term_num,
  base.criterion,
  (base.raw_rating - stats.mean) / stats.stddev,
  base.confidence,
  coalesce(base.samples, 0)::BIGINT,
  base.cumulative_samples::BIGINT,
  base.effective_samples
FROM instructor_rating_base AS base
JOIN criterion_stats AS stats USING (criterion, term_num)
WHERE stats.stddev > 0;

-- Confidence-weighted empirical Bayes with one common prior for each
-- family/criterion/term slice:
--   reliability = prior_variance / (prior_variance + 1 / confidence)
--   bayesian    = reliability * rating + (1 - reliability) * population_mean
--
-- The population mean includes every entity. A leave-one-out mean gives each
-- entity a different target and, with only two peers, makes each shrink toward
-- the other; that can reverse their order. One shared target avoids that sparse
-- group artifact and makes the adjustment consistent.
CREATE OR REPLACE TABLE entity_ratings AS
WITH population AS (
  SELECT
    *,
    count(*) OVER population_window AS entity_count,
    sum(confidence) OVER population_window AS total_confidence,
    sum(confidence * rating) OVER population_window AS total_weighted_rating,
    sum(confidence * rating * rating) OVER population_window AS total_weighted_rating_squared
  FROM entity_rating_base
  WINDOW population_window AS (PARTITION BY family, criterion, term_num)
), moments AS (
  SELECT
    *,
    total_weighted_rating / total_confidence AS population_mean,
    greatest(
      total_weighted_rating_squared / total_confidence
        - pow(total_weighted_rating / total_confidence, 2),
      0
    ) AS observed_variance,
    entity_count / total_confidence AS average_observation_variance
  FROM population
), priors AS (
  SELECT
    *,
    greatest(observed_variance - average_observation_variance, 1e-6) AS prior_variance
  FROM moments
), posterior AS (
  SELECT
    *,
    prior_variance / (prior_variance + 1 / confidence) AS reliability,
    sqrt(1 / (confidence + 1 / prior_variance)) AS posterior_stddev
  FROM priors
), adjusted AS (
  SELECT
    *,
    reliability * rating + (1 - reliability) * population_mean AS bayesian
  FROM posterior
)
SELECT
  family,
  entity_id,
  subject,
  code,
  name,
  term_num,
  criterion,
  rating,
  bayesian,
  confidence,
  samples,
  cumulative_samples,
  effective_samples,
  reliability,
  posterior_stddev
FROM adjusted;

-- Zero-sample Instructors and offered Courses receive the evidence-only prior.
-- They compete in Rankings but do not enter the mean or variance.
CREATE OR REPLACE TABLE prior_only_entity_ratings AS
WITH evidence_priors AS (
  SELECT
    family,
    criterion,
    term_num,
    sum(confidence * rating) / sum(confidence) AS population_mean,
    greatest(
      sum(confidence * rating * rating) / sum(confidence)
        - pow(sum(confidence * rating) / sum(confidence), 2)
        - count(*) / sum(confidence),
      1e-6
    ) AS prior_variance
  FROM entity_ratings
  GROUP BY family, criterion, term_num
), course_grid AS (
  SELECT
    'course' AS family,
    entities.subject || chr(31) || entities.code AS entity_id,
    entities.subject,
    entities.code,
    NULL::VARCHAR AS name,
    terms.term_num,
    criteria.criterion
  FROM course_entities AS entities
  JOIN terms ON terms.term_num >= entities.min_term_num
  JOIN evidence_priors AS criteria
    ON criteria.family = 'course' AND criteria.term_num = terms.term_num
), instructor_grid AS (
  SELECT
    'instructor' AS family,
    entities.uuid AS entity_id,
    NULL::VARCHAR AS subject,
    NULL::VARCHAR AS code,
    entities.name,
    terms.term_num,
    criteria.criterion
  FROM resolved_instructor_entities AS entities
  JOIN terms ON terms.term_num >= entities.min_term_num
  JOIN evidence_priors AS criteria
    ON criteria.family = 'instructor' AND criteria.term_num = terms.term_num
), grid AS (
  SELECT * FROM course_grid
  UNION ALL
  SELECT * FROM instructor_grid
)
SELECT
  grid.family,
  grid.entity_id,
  grid.subject,
  grid.code,
  grid.name,
  grid.term_num,
  grid.criterion,
  priors.population_mean AS rating,
  priors.population_mean AS bayesian,
  0::DOUBLE AS confidence,
  0::BIGINT AS samples,
  0::BIGINT AS cumulative_samples,
  0::DOUBLE AS effective_samples,
  0::DOUBLE AS reliability,
  sqrt(priors.prior_variance) AS posterior_stddev
FROM grid
JOIN evidence_priors AS priors
  USING (family, criterion, term_num)
WHERE NOT EXISTS (
  SELECT 1
  FROM entity_ratings AS evidence
  WHERE evidence.family = grid.family
    AND evidence.entity_id = grid.entity_id
    AND evidence.criterion = grid.criterion
    AND evidence.term_num = grid.term_num
);

CREATE OR REPLACE TABLE scored_entity_ratings AS
SELECT * FROM entity_ratings
UNION ALL
SELECT * FROM prior_only_entity_ratings;

-- Family-specific marts keep consumer schemas simple while sharing one model.
CREATE OR REPLACE TABLE course_ratings AS
SELECT
  ratings.subject,
  ratings.code,
  ratings.term_num,
  schedule.term_num IS NOT NULL AS is_offered,
  criterion,
  rating,
  bayesian,
  confidence,
  samples,
  cumulative_samples,
  effective_samples,
  reliability,
  posterior_stddev
FROM scored_entity_ratings AS ratings
LEFT JOIN schedule_course_terms AS schedule
  USING (subject, code, term_num)
WHERE family = 'course';

CREATE OR REPLACE TABLE instructor_ratings AS
SELECT
  ratings.entity_id AS uuid,
  ratings.name,
  ratings.term_num,
  schedule.uuid IS NOT NULL AS is_teaching,
  ratings.criterion,
  ratings.rating,
  ratings.bayesian,
  ratings.confidence,
  ratings.samples,
  ratings.cumulative_samples,
  ratings.effective_samples,
  ratings.reliability,
  ratings.posterior_stddev
FROM scored_entity_ratings AS ratings
LEFT JOIN resolved_schedule_teaching_assignments AS schedule
  ON schedule.uuid = ratings.entity_id
 AND schedule.term_num = ratings.term_num
WHERE ratings.family = 'instructor';

-- Snapshot exports are the latest dense term only; history remains in the marts.
CREATE OR REPLACE VIEW course_rankings AS
SELECT *
FROM course_ratings
WHERE term_num = (SELECT max(term_num) FROM terms);

CREATE OR REPLACE VIEW instructor_rankings AS
SELECT *
FROM instructor_ratings
WHERE term_num = (SELECT max(term_num) FROM terms);

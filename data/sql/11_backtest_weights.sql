-- 11_backtest_weights.sql — Apply one backtest candidate's evidence weights.
--
-- The identity and course-term stages do not depend on evidence weight. The
-- backtest runs those stages once, then uses this small stage before each
-- candidate's ratings calculation.

UPDATE review_observations
SET weight = greatest(
  0.25,
  1 + review_net_votes * getvariable('review_vote_scale')::DOUBLE
)::DOUBLE;

UPDATE sfq_course_observations
SET weight = (
  sfq_weight_base * (
    1 - getvariable('sfq_rate_penalty')::DOUBLE
    + getvariable('sfq_rate_penalty')::DOUBLE
      * (0.5 + 0.5 * sfq_response_rate)
  )
)::DOUBLE;

UPDATE sfq_instructor_observations
SET weight = (
  sfq_weight_base * (
    1 - getvariable('sfq_rate_penalty')::DOUBLE
    + getvariable('sfq_rate_penalty')::DOUBLE
      * (0.5 + 0.5 * sfq_response_rate)
  )
)::DOUBLE;

UPDATE observations AS target
SET weight = source.weight
FROM (
  SELECT observation_id, weight FROM review_observations
  UNION ALL
  SELECT observation_id, weight FROM sfq_course_observations
  UNION ALL
  SELECT observation_id, weight FROM sfq_instructor_observations
) AS source
WHERE source.observation_id = target.observation_id;

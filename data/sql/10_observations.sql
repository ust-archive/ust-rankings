-- 10_observations.sql — Convert current source rows into rating evidence.
--
-- Inputs:  source_* tables from 00_sources.sql.
-- Outputs: observations, observation_instructors, entity tables, dense term
--          grids, and course/instructor teaching metadata.
--
-- `observations` deliberately contains only positive rating evidence. Schedule
-- rows contribute coverage and teaching context through separate tables.

-- Normalized spelling key. Token order is preserved, so "Wang Wei" and
-- "Wei Wang" remain separate unless the clustering rules below connect them
-- with stronger evidence.
CREATE OR REPLACE MACRO instructor_name_key(value) AS (
  array_to_string(
    list_filter(
      string_split(
        trim(regexp_replace(lower(strip_accents(coalesce(value, ''))), '[^a-z]+', ' ', 'g')),
        ' '
      ),
      token -> token <> ''
    ),
    '|'
  )
);

-- Remove source placeholders before they can become instructor entities.
CREATE OR REPLACE MACRO valid_instructor_name(value) AS (
  length(trim(coalesce(value, ''))) > 0
  AND NOT regexp_matches(coalesce(value, ''), '[0-9]')
  AND instructor_name_key(value) NOT IN (
    '', 'tba', 'tbc', 'tbd', 'staff', 'instructor', 'teaching|team',
    'to|be|announced'
  )
  AND NOT contains(lower(coalesce(value, '')), 'teaching team')
  AND NOT contains(lower(coalesce(value, '')), 'program')
);

-- Split names only when the source spelling exposes a credible family-name
-- boundary: comma form ("IP, Ivan") or an all-caps family marker at either end
-- ("IP Ivan" / "Ivan IP"). Unstructured title case such as "Alice Alpha" can
-- still match exactly, but is not fuzzy-matched because its family name is not
-- reliably knowable without guessing a cultural name order.
CREATE OR REPLACE MACRO instructor_family_text(value) AS (
  CASE
    WHEN contains(coalesce(value, ''), ',')
      THEN trim(split_part(value, ',', 1))
    WHEN regexp_extract(
      trim(coalesce(value, '')),
      '^([A-Z][A-Z''-]+(?:[[:space:]]+[A-Z][A-Z''-]+)*)[[:space:]]+',
      1
    ) <> ''
      THEN regexp_extract(
        trim(value),
        '^([A-Z][A-Z''-]+(?:[[:space:]]+[A-Z][A-Z''-]+)*)[[:space:]]+',
        1
      )
    ELSE regexp_extract(
      trim(coalesce(value, '')),
      '([A-Z][A-Z''-]+(?:[[:space:]]+[A-Z][A-Z''-]+)*)$',
      1
    )
  END
);

CREATE OR REPLACE MACRO instructor_given_text(value) AS (
  CASE
    WHEN contains(coalesce(value, ''), ',')
      THEN trim(split_part(value, ',', 2))
    WHEN instructor_family_text(value) = ''
      THEN ''
    WHEN starts_with(trim(value), instructor_family_text(value))
      THEN trim(substr(trim(value), length(instructor_family_text(value)) + 1))
    ELSE trim(substr(
      trim(value),
      1,
      length(trim(value)) - length(instructor_family_text(value))
    ))
  END
);

CREATE OR REPLACE MACRO instructor_name_tokens(value) AS (
  list_filter(
    string_split(
      trim(regexp_replace(
        lower(strip_accents(coalesce(value, ''))),
        '[^a-z]+',
        ' ',
        'g'
      )),
      ' '
    ),
    token -> token <> ''
  )
);

-- Ordered initials are compatible only when both names expose at least two
-- given-name tokens. Thus "IP, I C H" may match "IP, Ivan Chi Ho", while a
-- risky single-token abbreviation such as "CHAN, J" is never expanded.
CREATE OR REPLACE MACRO instructor_initials_compatible(left_name, right_name) AS (
  instructor_name_tokens(instructor_family_text(left_name))
    = instructor_name_tokens(instructor_family_text(right_name))
  AND length(instructor_name_tokens(instructor_given_text(left_name))) >= 2
  AND length(instructor_name_tokens(instructor_given_text(left_name)))
    = length(instructor_name_tokens(instructor_given_text(right_name)))
  AND length(list_filter(
    range(1, length(instructor_name_tokens(instructor_given_text(left_name))) + 1),
    position -> NOT (
      instructor_name_tokens(instructor_given_text(left_name))[position]
        = instructor_name_tokens(instructor_given_text(right_name))[position]
      OR (
        length(instructor_name_tokens(instructor_given_text(left_name))[position]) = 1
        AND starts_with(
          instructor_name_tokens(instructor_given_text(right_name))[position],
          instructor_name_tokens(instructor_given_text(left_name))[position]
        )
      )
      OR (
        length(instructor_name_tokens(instructor_given_text(right_name))[position]) = 1
        AND starts_with(
          instructor_name_tokens(instructor_given_text(left_name))[position],
          instructor_name_tokens(instructor_given_text(right_name))[position]
        )
      )
    )
  )) = 0
);

-- Gather every usable spelling before selecting a canonical display name.
CREATE OR REPLACE TEMP TABLE raw_instructor_names AS
WITH names AS (
  SELECT 'schedule' AS source, instructor AS raw_name
  FROM source_schedule_classes AS classes,
    unnest(classes.schedules) AS schedules(schedule),
    unnest(schedule.instructors) AS names(instructor)
  UNION ALL
  SELECT 'review', instructor.name
  FROM source_reviews AS reviews,
    unnest(reviews.instructors) AS names(instructor)
  UNION ALL
  SELECT 'sfq', instructor_name
  FROM source_sfq_instructors
)
SELECT
  source,
  regexp_replace(
    regexp_replace(trim(raw_name), '[[:space:]]+', ' ', 'g'),
    '[[:space:]]*,[[:space:]]*',
    ', ',
    'g'
  ) AS raw_name
FROM names
WHERE valid_instructor_name(raw_name);

-- A course-term footprint is deliberately narrower than the later course
-- ownership table: primary scheduled classes, review offerings, and SFQ
-- instructor records only. It supplies corroboration for fuzzy aliases; it is
-- never itself rating evidence.
CREATE OR REPLACE TEMP TABLE instructor_name_footprints AS
SELECT DISTINCT
  'schedule' AS source,
  instructor AS raw_name,
  classes.term_num,
  upper(trim(courses.prefix)) AS subject,
  upper(trim(courses.number)) AS code
FROM source_schedule_classes AS classes
JOIN source_schedule_courses AS courses
  ON courses.term_num = classes.term_num
 AND courses.id = classes.course_id,
  unnest(classes.schedules) AS schedules(schedule),
  unnest(schedule.instructors) AS names(instructor)
WHERE classes.role = 'E'
  AND classes.type IN ('LEC', 'IND')
  AND valid_instructor_name(instructor)

UNION

SELECT DISTINCT
  'review',
  instructor.name,
  4 * substring(reviews.semester, 3, 2)::INTEGER
    + CASE split_part(reviews.semester, ' ', 2)
      WHEN 'Fall' THEN 1
      WHEN 'Winter' THEN 2
      WHEN 'Spring' THEN 3
      WHEN 'Summer' THEN 4
    END - 1,
  upper(trim(reviews.subject)),
  upper(trim(reviews.number))
FROM source_reviews AS reviews,
  unnest(reviews.instructors) AS names(instructor)
WHERE regexp_full_match(
    reviews.semester,
    '[0-9]{4}-[0-9]{2} (Fall|Winter|Spring|Summer)'
  )
  AND valid_instructor_name(instructor.name)

UNION

SELECT DISTINCT
  'sfq',
  instructor_name,
  term_num,
  upper(trim(prefix)),
  upper(trim(number))
FROM source_sfq_instructors
WHERE valid_instructor_name(instructor_name);

-- Pairs observed together block automatic aliasing. Schedule classes, review
-- instructor lists, and SFQ sections contribute to this guard; an explicit
-- merge event handles the rarer case where an upstream source duplicates one
-- person.
CREATE OR REPLACE TEMP TABLE instructor_coaliases AS
WITH record_names AS (
  SELECT DISTINCT
    'schedule:' || classes.term_num || ':' || classes.number AS record_id,
    instructor_name_key(instructor) AS name_key
  FROM source_schedule_classes AS classes,
    unnest(classes.schedules) AS schedules(schedule),
    unnest(schedule.instructors) AS names(instructor)
  WHERE valid_instructor_name(instructor)

  UNION

  SELECT DISTINCT
    'review:' || reviews.hash,
    instructor_name_key(instructor.name)
  FROM source_reviews AS reviews,
    unnest(reviews.instructors) AS names(instructor)
  WHERE valid_instructor_name(instructor.name)

  UNION

  SELECT DISTINCT
    concat_ws(
      ':', 'sfq', version, term_num::VARCHAR, school_code,
      prefix, number, section
    ),
    instructor_name_key(instructor_name)
  FROM source_sfq_instructors
  WHERE valid_instructor_name(instructor_name)
)
SELECT
  least(left_names.name_key, right_names.name_key) AS left_name_key,
  greatest(left_names.name_key, right_names.name_key) AS right_name_key
FROM record_names AS left_names
JOIN record_names AS right_names
  ON right_names.record_id = left_names.record_id
 AND right_names.name_key > left_names.name_key
GROUP BY ALL;

-- Every exact key starts as its own anchor. When several source spellings have
-- that key, prefer schedule, then review, then SFQ for the public name.
CREATE OR REPLACE TEMP TABLE instructor_name_anchors AS
WITH spellings AS (
  SELECT
    instructor_name_key(raw_name) AS name_key,
    raw_name,
    count(*) AS occurrences,
    max(CASE source WHEN 'schedule' THEN 3 WHEN 'review' THEN 2 ELSE 1 END)
      AS source_priority
  FROM raw_instructor_names
  GROUP BY name_key, raw_name
)
SELECT
  name_key,
  first(
    raw_name
    ORDER BY
      source_priority DESC,
      contains(raw_name, ',') DESC,
      occurrences DESC,
      length(raw_name) DESC,
      raw_name
  ) AS name,
  max(source_priority) AS source_priority
FROM spellings
GROUP BY name_key;

-- Candidate links are intentionally one hop into an exact anchor, rather than
-- a recursive graph. This prevents a weak alias from making another weak alias
-- appear authoritative. Compatible multi-initial names and reordered full
-- names may resolve toward a higher-priority source only when both spellings
-- occur for the same course in the same term.
--
-- A candidate is rejected if the spellings appeared together as instructors.
CREATE OR REPLACE TEMP TABLE instructor_resolution_candidates AS
WITH shared_offerings AS (
  SELECT
    instructor_name_key(aliases.raw_name) AS alias_key,
    instructor_name_key(anchors.raw_name) AS anchor_key,
    count(DISTINCT concat_ws(
      chr(31), aliases.term_num::VARCHAR, aliases.subject, aliases.code
    )) AS shared_course_terms
  FROM instructor_name_footprints AS aliases
  JOIN instructor_name_footprints AS anchors
    ON CASE anchors.source WHEN 'schedule' THEN 3 WHEN 'review' THEN 2 ELSE 1 END
      > CASE aliases.source WHEN 'schedule' THEN 3 WHEN 'review' THEN 2 ELSE 1 END
   AND anchors.term_num = aliases.term_num
   AND anchors.subject = aliases.subject
   AND anchors.code = aliases.code
  WHERE instructor_name_key(aliases.raw_name)
      <> instructor_name_key(anchors.raw_name)
  GROUP BY alias_key, anchor_key
)
SELECT
  aliases.name_key AS alias_key,
  anchor.name_key AS anchor_key,
  CASE anchor.source_priority
    WHEN 3 THEN 'schedule_overlap'
    ELSE 'review_sfq_overlap'
  END AS resolution_method,
  offerings.shared_course_terms,
  100 * anchor.source_priority + least(offerings.shared_course_terms, 99)
    AS resolution_score
FROM instructor_name_anchors AS aliases
JOIN shared_offerings AS offerings
  ON offerings.alias_key = aliases.name_key
JOIN instructor_name_anchors AS anchor
  ON anchor.name_key = offerings.anchor_key
 AND anchor.source_priority > aliases.source_priority
LEFT JOIN instructor_coaliases AS coaliases
  ON coaliases.left_name_key = least(aliases.name_key, anchor.name_key)
 AND coaliases.right_name_key = greatest(aliases.name_key, anchor.name_key)
WHERE coaliases.left_name_key IS NULL
  AND (
    instructor_initials_compatible(aliases.name, anchor.name)
    OR list_sort(instructor_name_tokens(aliases.name))
      = list_sort(instructor_name_tokens(anchor.name))
  );

-- Accept only one uniquely best candidate for an alias. A tie is not broken by
-- spelling or row order: ambiguous names intentionally remain separate.
CREATE OR REPLACE TEMP TABLE instructor_resolutions AS
WITH ranked AS (
  SELECT
    *,
    max(resolution_score) OVER (PARTITION BY alias_key) AS best_score
  FROM instructor_resolution_candidates
), best AS (
  SELECT
    *,
    count(*) OVER (PARTITION BY alias_key, resolution_score) AS best_matches
  FROM ranked
  WHERE resolution_score = best_score
), unique_best AS (
  SELECT *
  FROM best
  WHERE best_matches = 1
)
SELECT
  accepted.alias_key,
  accepted.anchor_key,
  accepted.resolution_method,
  accepted.shared_course_terms
FROM unique_best AS accepted
WHERE NOT EXISTS (
  -- Two aliases proposed for one anchor must not be known co-instructors. The
  -- direct alias/anchor pair was already checked in the candidate stage.
  SELECT 1
  FROM unique_best AS other
  JOIN instructor_coaliases AS coaliases
    ON coaliases.left_name_key = least(accepted.alias_key, other.alias_key)
   AND coaliases.right_name_key = greatest(accepted.alias_key, other.alias_key)
  WHERE other.anchor_key = accepted.anchor_key
    AND other.alias_key <> accepted.alias_key
);

-- Resolve all aliases to their exact or accepted one-hop anchor. The chosen
-- canonical name is the pipeline's intermediate key; export attaches the
-- registry-owned Instructor UUID.
CREATE OR REPLACE TABLE instructor_aliases AS
WITH resolved AS (
  SELECT
    aliases.name_key,
    coalesce(resolutions.anchor_key, aliases.name_key) AS anchor_key,
    coalesce(resolutions.resolution_method, 'exact') AS resolution_method,
    coalesce(resolutions.shared_course_terms, 0) AS shared_course_terms
  FROM instructor_name_anchors AS aliases
  LEFT JOIN instructor_resolutions AS resolutions
    ON resolutions.alias_key = aliases.name_key
)
SELECT
  resolved.name_key,
  coalesce(anchor.name, alias.name) AS name,
  resolved.resolution_method,
  resolved.shared_course_terms
FROM resolved
JOIN instructor_name_anchors AS alias
  ON alias.name_key = resolved.name_key
LEFT JOIN instructor_name_anchors AS anchor
  ON anchor.name_key = resolved.anchor_key;

-- Reviews expand from one source row to four criterion observations.
-- net_votes = upvotes - downvotes = 2 * upvotes - total votes.
-- Net votes adjust confidence linearly, with a floor of 0.25. Votes are not
-- additional respondents, so the sample count remains one review.
CREATE OR REPLACE TEMP TABLE review_observations AS
WITH prepared AS (
  SELECT
    *,
    substring(semester, 3, 2)::INTEGER AS academic_year,
    CASE split_part(semester, ' ', 2)
      WHEN 'Fall' THEN 1
      WHEN 'Winter' THEN 2
      WHEN 'Spring' THEN 3
      WHEN 'Summer' THEN 4
    END AS season,
    2 * upvote_count - vote_count AS net_votes
  FROM source_reviews
  WHERE regexp_full_match(semester, '[0-9]{4}-[0-9]{2} (Fall|Winter|Spring|Summer)')
    AND upvote_count >= 0
    AND vote_count >= upvote_count
), criteria AS (
  SELECT
    reviews.*,
    criterion,
    rating
  FROM prepared AS reviews
  CROSS JOIN LATERAL (
    VALUES
      ('content', reviews.content_rating),
      ('teaching', reviews.teaching_rating),
      ('grading', reviews.grading_rating),
      ('workload', reviews.workload_rating)
  ) AS values_by_criterion(criterion, rating)
)
SELECT
  'review:' || hash || ':' || criterion AS observation_id,
  'review' AS source,
  4 * academic_year + season - 1 AS term_num,
  printf('%02d%d0', academic_year, season) AS term_code,
  upper(trim(subject)) AS subject,
  upper(trim(number)) AS code,
  criterion,
  rating::DOUBLE AS rating,
  greatest(
    0.25,
    1 + net_votes * getvariable('review_vote_scale')::DOUBLE
  )::DOUBLE AS weight,
  1::BIGINT AS samples,
  hash AS source_id
FROM criteria
WHERE rating BETWEEN 1 AND 5
  AND length(trim(subject)) > 0
  AND length(trim(number)) > 0;

-- Course SFQ comes from section_records: exactly one course score per section,
-- even when instructor_records contains several instructors for that section.
CREATE OR REPLACE TEMP TABLE sfq_course_observations AS
SELECT DISTINCT
  'sfq-course:' || sha256(concat_ws(
    chr(31), version, term_num::VARCHAR, school_code, prefix, number, section,
    num_invites::VARCHAR, is_low_response_rate::VARCHAR,
    response_rate::VARCHAR, course_overall_mean::VARCHAR,
    course_overall_sd::VARCHAR, instructor_overall_mean::VARCHAR,
    instructor_overall_sd::VARCHAR, sha256
  )) AS observation_id,
  'sfq' AS source,
  term_num,
  term_code,
  upper(trim(prefix)) AS subject,
  upper(trim(number)) AS code,
  'course' AS criterion,
  course_overall_mean::DOUBLE AS rating,
  (
    num_invites * response_rate * (
      1 - getvariable('sfq_rate_penalty')::DOUBLE
      + getvariable('sfq_rate_penalty')::DOUBLE * (0.5 + 0.5 * response_rate)
    )
  )::DOUBLE AS weight,
  round(num_invites * response_rate)::BIGINT AS samples,
  version,
  school_code,
  section
FROM source_sfq_sections
WHERE num_invites > 0
  AND response_rate > 0 AND response_rate <= 1
  AND course_overall_mean BETWEEN 1 AND 5
  AND length(trim(prefix)) > 0
  AND length(trim(number)) > 0;

-- Instructor SFQ comes from instructor_records because the instructor score is
-- genuinely instructor-specific. Both SFQ weights approximate usable response
-- evidence and down-weight low response rates continuously.
CREATE OR REPLACE TEMP TABLE sfq_instructor_observations AS
SELECT DISTINCT
  'sfq-instructor:' || sha256(concat_ws(
    chr(31), version, term_num::VARCHAR, school_code, prefix, number, section,
    instructor_name, num_invites::VARCHAR, is_low_response_rate::VARCHAR,
    response_rate::VARCHAR, course_overall_mean::VARCHAR,
    course_overall_sd::VARCHAR, instructor_overall_mean::VARCHAR,
    instructor_overall_sd::VARCHAR, sha256
  )) AS observation_id,
  'sfq' AS source,
  term_num,
  term_code,
  upper(trim(prefix)) AS subject,
  upper(trim(number)) AS code,
  'instructor' AS criterion,
  instructor_overall_mean::DOUBLE AS rating,
  (
    num_invites * response_rate * (
      1 - getvariable('sfq_rate_penalty')::DOUBLE
      + getvariable('sfq_rate_penalty')::DOUBLE * (0.5 + 0.5 * response_rate)
    )
  )::DOUBLE AS weight,
  round(num_invites * response_rate)::BIGINT AS samples,
  instructor_name
FROM source_sfq_instructors
WHERE num_invites > 0
  AND response_rate > 0 AND response_rate <= 1
  AND instructor_overall_mean BETWEEN 1 AND 5
  AND valid_instructor_name(instructor_name)
  AND length(trim(prefix)) > 0
  AND length(trim(number)) > 0;

-- Shared long-form contract used by every downstream calculation.
CREATE OR REPLACE TABLE observations AS
SELECT * EXCLUDE (source_id) FROM review_observations
UNION ALL BY NAME
SELECT * EXCLUDE (version, school_code, section) FROM sfq_course_observations
UNION ALL BY NAME
SELECT * EXCLUDE (instructor_name) FROM sfq_instructor_observations;

-- Many-to-many bridge from evidence to people. The third branch reattaches a
-- section-level course score to its instructors for course-context weighting;
-- DISTINCT prevents this metadata join from duplicating the score itself.
CREATE OR REPLACE TABLE observation_instructors AS
SELECT DISTINCT observation_id, name
FROM (
  SELECT observations.observation_id, aliases.name
  FROM review_observations AS observations
  JOIN source_reviews AS reviews ON reviews.hash = observations.source_id,
    unnest(reviews.instructors) AS names(instructor)
  JOIN instructor_aliases AS aliases
    ON aliases.name_key = instructor_name_key(instructor.name)
  WHERE valid_instructor_name(instructor.name)

  UNION ALL

  SELECT observations.observation_id, aliases.name
  FROM sfq_instructor_observations AS observations
  JOIN instructor_aliases AS aliases
    ON aliases.name_key = instructor_name_key(observations.instructor_name)

  UNION ALL

  SELECT observations.observation_id, aliases.name
  FROM sfq_course_observations AS observations
  JOIN source_sfq_instructors AS sfq
    ON sfq.version = observations.version
   AND sfq.term_num = observations.term_num
   AND sfq.school_code = observations.school_code
   AND upper(trim(sfq.prefix)) = observations.subject
   AND upper(trim(sfq.number)) = observations.code
   AND sfq.section = observations.section
  JOIN instructor_aliases AS aliases
    ON aliases.name_key = instructor_name_key(sfq.instructor_name)
  WHERE valid_instructor_name(sfq.instructor_name)
);

-- Schedule-only relations preserve the distinction between evidence that names
-- a course/instructor and an active schedule record for that exact term.
CREATE OR REPLACE TABLE schedule_course_terms AS
SELECT DISTINCT
  upper(trim(prefix)) AS subject,
  upper(trim(number)) AS code,
  term_num
FROM source_schedule_courses
WHERE length(trim(prefix)) > 0 AND length(trim(number)) > 0;

CREATE OR REPLACE TABLE schedule_teaching_assignments AS
SELECT DISTINCT
  aliases.name,
  classes.term_num,
  upper(trim(courses.prefix)) AS subject,
  upper(trim(courses.number)) AS code
FROM source_schedule_classes AS classes
JOIN source_schedule_courses AS courses
  ON courses.term_num = classes.term_num
 AND courses.id = classes.course_id,
  unnest(classes.schedules) AS schedules(schedule),
  unnest(schedule.instructors) AS names(instructor)
JOIN instructor_aliases AS aliases
  ON aliases.name_key = instructor_name_key(instructor)
WHERE classes.role = 'E'
  AND classes.type IN ('LEC', 'IND')
  AND valid_instructor_name(instructor);

-- Coverage is the union of rated courses and current schedule courses. This
-- retains courses that have metadata but no rating evidence yet.
CREATE OR REPLACE TEMP TABLE course_coverage AS
SELECT DISTINCT subject, code, term_num, term_code
FROM observations
UNION
SELECT
  subject,
  code,
  term_num,
  printf('%02d%d0', floor(term_num / 4)::INTEGER, term_num % 4 + 1)
FROM schedule_course_terms;

CREATE OR REPLACE TABLE course_entities AS
SELECT subject, code, min(term_num)::INTEGER AS min_term_num
FROM course_coverage
GROUP BY subject, code;

-- Generate every institutional term between the global bounds. Each entity's
-- later grid begins at its own first observed/covered term.
CREATE OR REPLACE TABLE terms AS
WITH bounds AS (
  SELECT min(term_num)::INTEGER AS first_term, max(term_num)::INTEGER AS last_term
  FROM course_coverage
)
SELECT
  term_num::INTEGER AS term_num,
  printf('%02d%d0', floor(term_num / 4)::INTEGER, term_num % 4 + 1) AS term_code
FROM bounds, range(first_term, last_term + 1) AS generated(term_num)
ORDER BY term_num;

CREATE OR REPLACE TABLE course_terms AS
SELECT entities.subject, entities.code, terms.term_num
FROM course_entities AS entities
JOIN terms ON terms.term_num >= entities.min_term_num;

-- Teaching context comes from rating evidence plus primary schedule classes.
-- Tutorials/labs and invalid placeholder names do not define course ownership.
CREATE OR REPLACE TABLE course_term_instructors AS
SELECT DISTINCT subject, code, term_num, name
FROM (
  SELECT
    observations.subject,
    observations.code,
    observations.term_num,
    bridge.name
  FROM observations
  JOIN observation_instructors AS bridge USING (observation_id)

  UNION ALL

  SELECT subject, code, term_num, name
  FROM schedule_teaching_assignments
);

-- Instructor grids use the canonical clustered name before UUID attachment.
CREATE OR REPLACE TABLE instructor_entities AS
SELECT name, min(term_num)::INTEGER AS min_term_num
FROM course_term_instructors
GROUP BY name;

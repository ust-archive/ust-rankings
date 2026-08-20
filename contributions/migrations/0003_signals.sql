CREATE TABLE course_thumbs_votes (
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  course_prefix text NOT NULL CHECK (
    course_prefix = upper(course_prefix) AND course_prefix ~ '^[A-Z]{2,8}$'
  ),
  course_number text NOT NULL CHECK (
    course_number = upper(course_number)
    AND course_number ~ '^[0-9]{3,5}([A-Z]|-[0-9]{3,5})?$'
  ),
  state text NOT NULL CHECK (state IN ('up', 'down')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_prefix, course_number)
);

CREATE INDEX course_thumbs_counts_idx
ON course_thumbs_votes (course_prefix, course_number, state);

CREATE TABLE instructor_thumbs_votes (
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  instructor_uuid uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('up', 'down')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, instructor_uuid)
);

CREATE INDEX instructor_thumbs_counts_idx
ON instructor_thumbs_votes (instructor_uuid, state);

CREATE TABLE course_emoji_reactions (
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  course_prefix text NOT NULL CHECK (
    course_prefix = upper(course_prefix) AND course_prefix ~ '^[A-Z]{2,8}$'
  ),
  course_number text NOT NULL CHECK (
    course_number = upper(course_number)
    AND course_number ~ '^[0-9]{3,5}([A-Z]|-[0-9]{3,5})?$'
  ),
  code text NOT NULL CHECK (
    code IN ('love', 'laugh', 'surprised', 'confused', 'sad', 'angry', 'fire')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_prefix, course_number, code)
);

CREATE INDEX course_emoji_counts_idx
ON course_emoji_reactions (course_prefix, course_number, code);

CREATE TABLE instructor_emoji_reactions (
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  instructor_uuid uuid NOT NULL,
  code text NOT NULL CHECK (
    code IN ('love', 'laugh', 'surprised', 'confused', 'sad', 'angry', 'fire')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, instructor_uuid, code)
);

CREATE INDEX instructor_emoji_counts_idx
ON instructor_emoji_reactions (instructor_uuid, code);

-- Durable redirects prevent a mutation that began before an Instructor merge
-- from recreating signal rows on the retired UUID after the merge commits.
CREATE TABLE instructor_signal_redirects (
  retired_uuid uuid PRIMARY KEY,
  survivor_uuid uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (retired_uuid <> survivor_uuid)
);

CREATE INDEX instructor_signal_redirects_survivor_idx
ON instructor_signal_redirects (survivor_uuid);

-- Instructor writes take this key in shared mode; graph-changing merges take
-- it exclusively before per-UUID locks so redirect chains cannot race writes.
CREATE FUNCTION merge_instructor_signals(
  p_retired_uuid uuid,
  p_survivor_uuid uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  resolved_survivor uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(1431520338, 47);
  PERFORM pg_advisory_xact_lock(
    hashtextextended(least(p_retired_uuid, p_survivor_uuid)::text, 47)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(greatest(p_retired_uuid, p_survivor_uuid)::text, 47)
  );

  WITH RECURSIVE chain(uuid) AS (
    VALUES (p_survivor_uuid)
    UNION
    SELECT redirects.survivor_uuid
    FROM instructor_signal_redirects redirects
    JOIN chain ON redirects.retired_uuid = chain.uuid
  )
  SELECT uuid INTO resolved_survivor
  FROM chain
  WHERE NOT EXISTS (
    SELECT 1 FROM instructor_signal_redirects WHERE retired_uuid = chain.uuid
  )
  LIMIT 1;

  IF resolved_survivor IS NULL OR p_retired_uuid = resolved_survivor THEN
    RAISE EXCEPTION 'invalid or cyclic Instructor signal merge'
      USING ERRCODE = '22023';
  END IF;

  UPDATE instructor_signal_redirects
  SET survivor_uuid = resolved_survivor
  WHERE survivor_uuid = p_retired_uuid;
  INSERT INTO instructor_signal_redirects (retired_uuid, survivor_uuid)
  VALUES (p_retired_uuid, resolved_survivor)
  ON CONFLICT (retired_uuid)
  DO UPDATE SET survivor_uuid = EXCLUDED.survivor_uuid;

  INSERT INTO instructor_thumbs_votes
    (user_id, instructor_uuid, state, updated_at)
  SELECT user_id, resolved_survivor, state, updated_at
  FROM instructor_thumbs_votes
  WHERE instructor_uuid = p_retired_uuid
  ON CONFLICT (user_id, instructor_uuid) DO UPDATE
  SET state = CASE
        WHEN EXCLUDED.updated_at > instructor_thumbs_votes.updated_at
        THEN EXCLUDED.state ELSE instructor_thumbs_votes.state END,
      updated_at = greatest(
        EXCLUDED.updated_at, instructor_thumbs_votes.updated_at
      );
  DELETE FROM instructor_thumbs_votes
  WHERE instructor_uuid = p_retired_uuid;

  INSERT INTO instructor_emoji_reactions
    (user_id, instructor_uuid, code, created_at)
  SELECT user_id, resolved_survivor, code, created_at
  FROM instructor_emoji_reactions
  WHERE instructor_uuid = p_retired_uuid
  ON CONFLICT DO NOTHING;
  DELETE FROM instructor_emoji_reactions
  WHERE instructor_uuid = p_retired_uuid;
END;
$$;

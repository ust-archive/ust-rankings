CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  author_user_id uuid NOT NULL REFERENCES contribution_users(id),
  publication_state text NOT NULL DEFAULT 'active'
    CHECK (publication_state IN ('active', 'withdrawn')),
  course_prefix text NOT NULL CHECK (
    course_prefix = upper(course_prefix) AND course_prefix ~ '^[A-Z]{2,8}$'
  ),
  course_number text NOT NULL CHECK (
    course_number = upper(course_number)
    AND course_number ~ '^[0-9]{3,5}([A-Z]|-[0-9]{3,5})?$'
  ),
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, current_revision_id)
);

CREATE UNIQUE INDEX reviews_active_course_tuple_idx
ON reviews (author_user_id, course_prefix, course_number)
WHERE publication_state = 'active';
CREATE INDEX reviews_public_course_idx
ON reviews (course_prefix, course_number, publication_state, updated_at DESC);
CREATE INDEX reviews_author_idx ON reviews (author_user_id);

CREATE TABLE review_revisions (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES reviews(id),
  markdown text NOT NULL CHECK (length(btrim(markdown)) > 0),
  attribution text NOT NULL CHECK (attribution = 'attributed'),
  captured_display_name text NOT NULL CHECK (length(captured_display_name) > 0),
  policy_version text NOT NULL CHECK (length(policy_version) > 0),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, id)
);

ALTER TABLE reviews ADD CONSTRAINT reviews_current_revision_fk
FOREIGN KEY (id, current_revision_id)
REFERENCES review_revisions (review_id, id);

CREATE INDEX review_revisions_review_idx
ON review_revisions (review_id, published_at DESC);

CREATE TABLE review_course_bases (
  revision_id uuid PRIMARY KEY REFERENCES review_revisions(id),
  course_prefix text NOT NULL CHECK (
    course_prefix = upper(course_prefix) AND course_prefix ~ '^[A-Z]{2,8}$'
  ),
  course_number text NOT NULL CHECK (
    course_number = upper(course_number)
    AND course_number ~ '^[0-9]{3,5}([A-Z]|-[0-9]{3,5})?$'
  )
);

CREATE INDEX review_course_bases_course_idx
ON review_course_bases (course_prefix, course_number);

CREATE FUNCTION publish_attributed_course_review(
  p_review_id uuid,
  p_revision_id uuid,
  p_user_id uuid,
  p_course_prefix text,
  p_course_number text,
  p_markdown text,
  p_policy_version text
) RETURNS TABLE (
  review_id uuid,
  revision_id uuid,
  captured_display_name text,
  published_at timestamptz
)
LANGUAGE plpgsql AS $$
DECLARE
  account_status text;
  display_name text;
BEGIN
  SELECT status, public_display_name
  INTO account_status, display_name
  FROM contribution_users
  WHERE id = p_user_id
  FOR UPDATE;

  IF account_status IS NULL THEN
    RAISE EXCEPTION 'account-not-found';
  ELSIF account_status = 'onboarding' THEN
    RAISE EXCEPTION 'onboarding-required';
  ELSIF account_status = 'suspended' THEN
    RAISE EXCEPTION 'account-suspended';
  ELSIF account_status = 'closed' THEN
    RAISE EXCEPTION 'account-closed';
  ELSIF display_name IS NULL THEN
    RAISE EXCEPTION 'onboarding-required';
  END IF;

  INSERT INTO reviews (
    id, author_user_id, course_prefix, course_number, current_revision_id
  ) VALUES (
    p_review_id, p_user_id, p_course_prefix, p_course_number, NULL
  );
  INSERT INTO review_revisions (
    id, review_id, markdown, attribution, captured_display_name, policy_version
  ) VALUES (
    p_revision_id, p_review_id, p_markdown, 'attributed', display_name,
    p_policy_version
  );
  INSERT INTO review_course_bases (
    revision_id, course_prefix, course_number
  ) VALUES (
    p_revision_id, p_course_prefix, p_course_number
  );
  UPDATE reviews
  SET current_revision_id = p_revision_id, updated_at = now()
  WHERE id = p_review_id;

  RETURN QUERY
  SELECT p_review_id, p_revision_id, display_name, rr.published_at
  FROM review_revisions rr
  WHERE rr.id = p_revision_id;
END;
$$;

CREATE FUNCTION prevent_review_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Review Revisions are immutable';
END;
$$;

CREATE TRIGGER review_revisions_immutable
BEFORE UPDATE OR DELETE ON review_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_review_revision_mutation();

CREATE TRIGGER review_course_bases_immutable
BEFORE UPDATE OR DELETE ON review_course_bases
FOR EACH ROW EXECUTE FUNCTION prevent_review_revision_mutation();

ALTER TABLE review_revisions
  DROP CONSTRAINT review_revisions_attribution_check,
  ALTER COLUMN captured_display_name DROP NOT NULL,
  ADD CONSTRAINT review_revisions_attribution_check CHECK (
    (attribution = 'attributed' AND captured_display_name IS NOT NULL
      AND length(captured_display_name) > 0)
    OR (attribution = 'identity-hidden' AND captured_display_name IS NULL)
  );

CREATE FUNCTION review_author_display_name(p_user_id uuid) RETURNS text
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
  RETURN display_name;
END;
$$;

CREATE FUNCTION insert_review_revision_snapshot(
  p_review_id uuid,
  p_revision_id uuid,
  p_course_prefix text,
  p_course_number text,
  p_instructor_uuid uuid,
  p_term_code text,
  p_section text,
  p_markdown text,
  p_attribution text,
  p_display_name text,
  p_policy_version text
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO review_revisions (
    id, review_id, markdown, attribution, captured_display_name, policy_version
  ) VALUES (
    p_revision_id, p_review_id, p_markdown, p_attribution,
    CASE WHEN p_attribution = 'attributed' THEN p_display_name ELSE NULL END,
    p_policy_version
  );
  IF p_course_prefix IS NOT NULL THEN
    INSERT INTO review_course_bases (
      revision_id, course_prefix, course_number
    ) VALUES (p_revision_id, p_course_prefix, p_course_number);
  END IF;
  IF p_instructor_uuid IS NOT NULL THEN
    INSERT INTO review_instructor_bases (revision_id, instructor_uuid)
    VALUES (p_revision_id, p_instructor_uuid);
  END IF;
  IF p_term_code IS NOT NULL THEN
    INSERT INTO review_contexts (revision_id, term_code, section)
    VALUES (p_revision_id, p_term_code, p_section);
  END IF;
END;
$$;

CREATE FUNCTION publish_review(
  p_review_id uuid,
  p_revision_id uuid,
  p_user_id uuid,
  p_course_prefix text,
  p_course_number text,
  p_instructor_uuid uuid,
  p_term_code text,
  p_section text,
  p_markdown text,
  p_attribution text,
  p_policy_version text
) RETURNS TABLE (
  review_id uuid,
  revision_id uuid,
  attribution text,
  captured_display_name text,
  published_at timestamptz
)
LANGUAGE plpgsql AS $$
DECLARE
  display_name text;
BEGIN
  display_name := review_author_display_name(p_user_id);
  INSERT INTO reviews (
    id, author_user_id, course_prefix, course_number, instructor_uuid,
    instructor_association_status, term_code, section, current_revision_id
  ) VALUES (
    p_review_id, p_user_id, p_course_prefix, p_course_number, p_instructor_uuid,
    CASE WHEN p_instructor_uuid IS NULL THEN NULL ELSE 'resolved' END,
    p_term_code, p_section, NULL
  );
  PERFORM insert_review_revision_snapshot(
    p_review_id, p_revision_id, p_course_prefix, p_course_number,
    p_instructor_uuid, p_term_code, p_section, p_markdown, p_attribution,
    display_name, p_policy_version
  );
  UPDATE reviews
  SET current_revision_id = p_revision_id, updated_at = now()
  WHERE id = p_review_id;

  RETURN QUERY
  SELECT p_review_id, p_revision_id, rr.attribution,
         rr.captured_display_name, rr.published_at
  FROM review_revisions rr WHERE rr.id = p_revision_id;
END;
$$;

CREATE FUNCTION edit_review(
  p_review_id uuid,
  p_revision_id uuid,
  p_expected_revision_id uuid,
  p_user_id uuid,
  p_course_prefix text,
  p_course_number text,
  p_instructor_uuid uuid,
  p_term_code text,
  p_section text,
  p_markdown text,
  p_attribution text,
  p_policy_version text
) RETURNS TABLE (
  review_id uuid,
  revision_id uuid,
  attribution text,
  captured_display_name text,
  published_at timestamptz
)
LANGUAGE plpgsql AS $$
DECLARE
  display_name text;
  review_author_id uuid;
  review_state text;
  current_revision uuid;
BEGIN
  display_name := review_author_display_name(p_user_id);
  SELECT author_user_id, publication_state, current_revision_id
  INTO review_author_id, review_state, current_revision
  FROM reviews WHERE id = p_review_id FOR UPDATE;

  IF review_author_id IS NULL THEN
    RAISE EXCEPTION 'review-not-found';
  ELSIF review_author_id <> p_user_id THEN
    RAISE EXCEPTION 'wrong-owner';
  ELSIF review_state <> 'active' THEN
    RAISE EXCEPTION 'review-withdrawn';
  ELSIF current_revision <> p_expected_revision_id THEN
    RAISE EXCEPTION 'stale-review';
  END IF;

  PERFORM insert_review_revision_snapshot(
    p_review_id, p_revision_id, p_course_prefix, p_course_number,
    p_instructor_uuid, p_term_code, p_section, p_markdown, p_attribution,
    display_name, p_policy_version
  );
  UPDATE reviews
  SET course_prefix = p_course_prefix,
      course_number = p_course_number,
      instructor_uuid = p_instructor_uuid,
      instructor_association_status = CASE
        WHEN p_instructor_uuid IS NULL THEN NULL ELSE 'resolved'
      END,
      term_code = p_term_code,
      section = p_section,
      current_revision_id = p_revision_id,
      updated_at = now()
  WHERE id = p_review_id;

  RETURN QUERY
  SELECT p_review_id, p_revision_id, rr.attribution,
         rr.captured_display_name, rr.published_at
  FROM review_revisions rr WHERE rr.id = p_revision_id;
END;
$$;

CREATE FUNCTION withdraw_review(
  p_review_id uuid,
  p_expected_revision_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  ignored_display_name text;
  review_author_id uuid;
  review_state text;
  current_revision uuid;
BEGIN
  ignored_display_name := review_author_display_name(p_user_id);
  SELECT author_user_id, publication_state, current_revision_id
  INTO review_author_id, review_state, current_revision
  FROM reviews WHERE id = p_review_id FOR UPDATE;

  IF review_author_id IS NULL THEN
    RAISE EXCEPTION 'review-not-found';
  ELSIF review_author_id <> p_user_id THEN
    RAISE EXCEPTION 'wrong-owner';
  ELSIF review_state <> 'active' THEN
    RAISE EXCEPTION 'review-withdrawn';
  ELSIF current_revision <> p_expected_revision_id THEN
    RAISE EXCEPTION 'stale-review';
  END IF;

  UPDATE reviews
  SET publication_state = 'withdrawn', updated_at = now()
  WHERE id = p_review_id;
END;
$$;

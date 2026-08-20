ALTER TABLE reviews
  ALTER COLUMN course_prefix DROP NOT NULL,
  ALTER COLUMN course_number DROP NOT NULL,
  ADD COLUMN instructor_uuid uuid,
  ADD COLUMN term_code text,
  ADD COLUMN section text,
  ADD COLUMN instructor_association_status text;

ALTER TABLE reviews ADD CONSTRAINT reviews_complete_associations_check CHECK (
  (course_prefix IS NULL) = (course_number IS NULL)
  AND (course_prefix IS NOT NULL OR instructor_uuid IS NOT NULL)
  AND (section IS NULL OR (course_prefix IS NOT NULL AND term_code IS NOT NULL))
  AND (term_code IS NULL OR term_code ~ '^[0-9]{4}$')
  AND (section IS NULL OR (section = upper(section) AND section ~ '^[A-Z][A-Z0-9-]{0,15}$'))
  AND (
    (instructor_uuid IS NULL AND instructor_association_status IS NULL)
    OR (instructor_uuid IS NOT NULL AND instructor_association_status IN (
      'resolved', 'historical', 'needs-resolution'
    ))
  )
);

DROP INDEX reviews_active_course_tuple_idx;
CREATE UNIQUE INDEX reviews_active_association_tuple_idx
ON reviews (
  author_user_id, course_prefix, course_number, instructor_uuid, term_code, section
) NULLS NOT DISTINCT
WHERE publication_state = 'active';
CREATE INDEX reviews_public_instructor_idx
ON reviews (instructor_uuid, publication_state, updated_at DESC)
WHERE instructor_uuid IS NOT NULL;
CREATE INDEX reviews_public_context_idx
ON reviews (course_prefix, course_number, term_code, section, publication_state)
WHERE term_code IS NOT NULL;

CREATE TABLE review_instructor_bases (
  revision_id uuid PRIMARY KEY REFERENCES review_revisions(id),
  instructor_uuid uuid NOT NULL
);
CREATE INDEX review_instructor_bases_instructor_idx
ON review_instructor_bases (instructor_uuid);

CREATE TABLE review_contexts (
  revision_id uuid PRIMARY KEY REFERENCES review_revisions(id),
  term_code text NOT NULL CHECK (term_code ~ '^[0-9]{4}$'),
  section text CHECK (
    section IS NULL OR (section = upper(section) AND section ~ '^[A-Z][A-Z0-9-]{0,15}$')
  )
);
CREATE INDEX review_contexts_term_section_idx
ON review_contexts (term_code, section);

CREATE TRIGGER review_instructor_bases_immutable
BEFORE UPDATE OR DELETE ON review_instructor_bases
FOR EACH ROW EXECUTE FUNCTION prevent_review_revision_mutation();
CREATE TRIGGER review_contexts_immutable
BEFORE UPDATE OR DELETE ON review_contexts
FOR EACH ROW EXECUTE FUNCTION prevent_review_revision_mutation();

CREATE FUNCTION publish_attributed_review(
  p_review_id uuid,
  p_revision_id uuid,
  p_user_id uuid,
  p_course_prefix text,
  p_course_number text,
  p_instructor_uuid uuid,
  p_term_code text,
  p_section text,
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
    id, author_user_id, course_prefix, course_number, instructor_uuid,
    instructor_association_status, term_code, section, current_revision_id
  ) VALUES (
    p_review_id, p_user_id, p_course_prefix, p_course_number, p_instructor_uuid,
    CASE WHEN p_instructor_uuid IS NULL THEN NULL ELSE 'resolved' END,
    p_term_code, p_section, NULL
  );
  INSERT INTO review_revisions (
    id, review_id, markdown, attribution, captured_display_name, policy_version
  ) VALUES (
    p_revision_id, p_review_id, p_markdown, 'attributed', display_name,
    p_policy_version
  );
  IF p_course_prefix IS NOT NULL THEN
    INSERT INTO review_course_bases (
      revision_id, course_prefix, course_number
    ) VALUES (
      p_revision_id, p_course_prefix, p_course_number
    );
  END IF;
  IF p_instructor_uuid IS NOT NULL THEN
    INSERT INTO review_instructor_bases (revision_id, instructor_uuid)
    VALUES (p_revision_id, p_instructor_uuid);
  END IF;
  IF p_term_code IS NOT NULL THEN
    INSERT INTO review_contexts (revision_id, term_code, section)
    VALUES (p_revision_id, p_term_code, p_section);
  END IF;
  UPDATE reviews
  SET current_revision_id = p_revision_id, updated_at = now()
  WHERE id = p_review_id;

  RETURN QUERY
  SELECT p_review_id, p_revision_id, display_name, rr.published_at
  FROM review_revisions rr
  WHERE rr.id = p_revision_id;
END;
$$;

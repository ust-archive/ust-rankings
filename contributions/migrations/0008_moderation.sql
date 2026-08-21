ALTER TABLE reviews
  ADD COLUMN attribution_suppressed boolean NOT NULL DEFAULT false;

CREATE TABLE review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES reviews(id),
  reporter_user_id uuid NOT NULL REFERENCES contribution_users(id),
  reason_category text NOT NULL CHECK (reason_category IN (
    'third-party-personal-data',
    'doxxing',
    'threats',
    'harassment',
    'slurs',
    'discriminatory-abuse',
    'impersonation',
    'spam',
    'deceptive-links',
    'confidential-materials',
    'unsupported-allegations',
    'personal-attacks',
    'malicious-files',
    'high-risk-data'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_reports_one_per_user UNIQUE (review_id, reporter_user_id)
);

CREATE INDEX review_reports_review_idx ON review_reports (review_id);

CREATE TABLE moderation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  target_type text NOT NULL CHECK (target_type IN ('review', 'stored-file', 'user')),
  target_id uuid NOT NULL,
  reason_category text NOT NULL CHECK (length(btrim(reason_category)) > 0),
  operator_identifier text CHECK (
    operator_identifier IS NULL OR length(btrim(operator_identifier)) > 0
  ),
  action text NOT NULL CHECK (action IN (
    'report',
    'withdraw-review',
    'suppress-attribution',
    'remove-stored-file',
    'suspend-user',
    'identity-lookup'
  )),
  outcome text NOT NULL CHECK (length(btrim(outcome)) > 0),
  identity_lookup_reason text CHECK (
    identity_lookup_reason IS NULL OR identity_lookup_reason IN (
      'report', 'security-incident', 'rights-request', 'legal-request'
    )
  ),
  CHECK (
    (action = 'report'
      AND operator_identifier IS NULL
      AND identity_lookup_reason IS NULL)
    OR (action = 'identity-lookup'
      AND operator_identifier IS NOT NULL
      AND identity_lookup_reason IS NOT NULL)
    OR (action NOT IN ('report', 'identity-lookup')
      AND operator_identifier IS NOT NULL
      AND identity_lookup_reason IS NULL)
  )
);

CREATE INDEX moderation_cases_target_idx
ON moderation_cases (target_type, target_id, created_at DESC);

CREATE FUNCTION require_active_moderation_user(p_user_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  account_status text;
BEGIN
  SELECT status INTO account_status
  FROM contribution_users
  WHERE contribution_users.id = p_user_id
  FOR UPDATE;

  IF account_status IS NULL THEN
    RAISE EXCEPTION 'account-not-found';
  ELSIF account_status = 'onboarding' THEN
    RAISE EXCEPTION 'onboarding-required';
  ELSIF account_status = 'suspended' THEN
    RAISE EXCEPTION 'account-suspended';
  ELSIF account_status = 'closed' THEN
    RAISE EXCEPTION 'account-closed';
  END IF;
END;
$$;

CREATE FUNCTION report_review(
  p_user_id uuid,
  p_review_id uuid,
  p_reason_category text
) RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  target_type text,
  target_id uuid,
  reason_category text,
  operator_identifier text,
  action text,
  outcome text,
  identity_lookup_reason text
)
LANGUAGE plpgsql AS $$
DECLARE
  review_state text;
  case_id uuid;
BEGIN
  PERFORM require_active_moderation_user(p_user_id);
  SELECT publication_state INTO review_state
  FROM reviews WHERE reviews.id = p_review_id FOR UPDATE;
  IF review_state IS NULL OR review_state <> 'active' THEN
    RAISE EXCEPTION 'review-not-found';
  END IF;

  INSERT INTO review_reports (review_id, reporter_user_id, reason_category)
  VALUES (p_review_id, p_user_id, p_reason_category);

  INSERT INTO moderation_cases (
    target_type, target_id, reason_category, action, outcome
  ) VALUES (
    'review', p_review_id, p_reason_category, 'report', 'recorded'
  ) RETURNING moderation_cases.id INTO case_id;

  RETURN QUERY
  SELECT c.id, c.created_at, c.target_type, c.target_id, c.reason_category,
         c.operator_identifier, c.action, c.outcome, c.identity_lookup_reason
  FROM moderation_cases c WHERE c.id = case_id;
END;
$$;

CREATE FUNCTION operator_withdraw_review(
  p_operator_identifier text,
  p_review_id uuid,
  p_reason_category text
) RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  target_type text,
  target_id uuid,
  reason_category text,
  operator_identifier text,
  action text,
  outcome text,
  identity_lookup_reason text
)
LANGUAGE plpgsql AS $$
DECLARE
  review_state text;
  case_id uuid;
BEGIN
  SELECT publication_state INTO review_state
  FROM reviews WHERE reviews.id = p_review_id FOR UPDATE;
  IF review_state IS NULL THEN
    RAISE EXCEPTION 'review-not-found';
  ELSIF review_state <> 'active' THEN
    RAISE EXCEPTION 'review-withdrawn';
  END IF;

  UPDATE reviews
  SET publication_state = 'withdrawn', updated_at = now()
  WHERE reviews.id = p_review_id;

  INSERT INTO moderation_cases (
    target_type, target_id, reason_category, operator_identifier, action, outcome
  ) VALUES (
    'review', p_review_id, p_reason_category, p_operator_identifier,
    'withdraw-review', 'withdrawn'
  ) RETURNING moderation_cases.id INTO case_id;

  RETURN QUERY
  SELECT c.id, c.created_at, c.target_type, c.target_id, c.reason_category,
         c.operator_identifier, c.action, c.outcome, c.identity_lookup_reason
  FROM moderation_cases c WHERE c.id = case_id;
END;
$$;

CREATE FUNCTION operator_suppress_attribution(
  p_operator_identifier text,
  p_review_id uuid,
  p_reason_category text
) RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  target_type text,
  target_id uuid,
  reason_category text,
  operator_identifier text,
  action text,
  outcome text,
  identity_lookup_reason text
)
LANGUAGE plpgsql AS $$
DECLARE
  review_state text;
  case_id uuid;
BEGIN
  SELECT publication_state INTO review_state
  FROM reviews WHERE reviews.id = p_review_id FOR UPDATE;
  IF review_state IS NULL THEN
    RAISE EXCEPTION 'review-not-found';
  ELSIF review_state <> 'active' THEN
    RAISE EXCEPTION 'review-withdrawn';
  END IF;

  UPDATE reviews
  SET attribution_suppressed = true, updated_at = now()
  WHERE reviews.id = p_review_id;

  INSERT INTO moderation_cases (
    target_type, target_id, reason_category, operator_identifier, action, outcome
  ) VALUES (
    'review', p_review_id, p_reason_category, p_operator_identifier,
    'suppress-attribution', 'attribution-suppressed'
  ) RETURNING moderation_cases.id INTO case_id;

  RETURN QUERY
  SELECT c.id, c.created_at, c.target_type, c.target_id, c.reason_category,
         c.operator_identifier, c.action, c.outcome, c.identity_lookup_reason
  FROM moderation_cases c WHERE c.id = case_id;
END;
$$;

CREATE FUNCTION operator_remove_stored_file(
  p_operator_identifier text,
  p_stored_file_id uuid,
  p_reason_category text
) RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  target_type text,
  target_id uuid,
  reason_category text,
  operator_identifier text,
  action text,
  outcome text,
  identity_lookup_reason text
)
LANGUAGE plpgsql AS $$
DECLARE
  removed timestamptz;
  case_id uuid;
BEGIN
  UPDATE stored_files
  SET removal_requested_at = COALESCE(removal_requested_at, now())
  WHERE stored_files.id = p_stored_file_id AND removed_at IS NULL
  RETURNING removed_at INTO removed;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stored-file-not-found';
  END IF;

  INSERT INTO moderation_cases (
    target_type, target_id, reason_category, operator_identifier, action, outcome
  ) VALUES (
    'stored-file', p_stored_file_id, p_reason_category, p_operator_identifier,
    'remove-stored-file', 'removal-queued'
  ) RETURNING moderation_cases.id INTO case_id;

  RETURN QUERY
  SELECT c.id, c.created_at, c.target_type, c.target_id, c.reason_category,
         c.operator_identifier, c.action, c.outcome, c.identity_lookup_reason
  FROM moderation_cases c WHERE c.id = case_id;
END;
$$;

CREATE FUNCTION operator_suspend_user(
  p_operator_identifier text,
  p_user_id uuid,
  p_reason_category text
) RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  target_type text,
  target_id uuid,
  reason_category text,
  operator_identifier text,
  action text,
  outcome text,
  identity_lookup_reason text
)
LANGUAGE plpgsql AS $$
DECLARE
  account_status text;
  case_id uuid;
BEGIN
  SELECT status INTO account_status
  FROM contribution_users WHERE contribution_users.id = p_user_id FOR UPDATE;
  IF account_status IS NULL THEN
    RAISE EXCEPTION 'user-not-found';
  ELSIF account_status = 'closed' THEN
    RAISE EXCEPTION 'account-closed';
  END IF;

  UPDATE contribution_users
  SET status = 'suspended', updated_at = now()
  WHERE contribution_users.id = p_user_id;

  INSERT INTO moderation_cases (
    target_type, target_id, reason_category, operator_identifier, action, outcome
  ) VALUES (
    'user', p_user_id, p_reason_category, p_operator_identifier,
    'suspend-user', 'suspended'
  ) RETURNING moderation_cases.id INTO case_id;

  RETURN QUERY
  SELECT c.id, c.created_at, c.target_type, c.target_id, c.reason_category,
         c.operator_identifier, c.action, c.outcome, c.identity_lookup_reason
  FROM moderation_cases c WHERE c.id = case_id;
END;
$$;

CREATE FUNCTION operator_lookup_identity(
  p_operator_identifier text,
  p_review_id uuid,
  p_reason text
) RETURNS TABLE (
  user_id uuid,
  id uuid,
  created_at timestamptz,
  target_type text,
  target_id uuid,
  reason_category text,
  operator_identifier text,
  action text,
  outcome text,
  identity_lookup_reason text
)
LANGUAGE plpgsql AS $$
DECLARE
  author_id uuid;
  case_id uuid;
BEGIN
  IF p_reason NOT IN (
    'report', 'security-incident', 'rights-request', 'legal-request'
  ) THEN
    RAISE EXCEPTION 'unjustified-lookup';
  END IF;

  SELECT author_user_id INTO author_id
  FROM reviews WHERE reviews.id = p_review_id FOR UPDATE;
  IF author_id IS NULL THEN
    RAISE EXCEPTION 'review-not-found';
  END IF;

  IF p_reason = 'report' AND NOT EXISTS (
    SELECT 1 FROM review_reports WHERE review_id = p_review_id
  ) THEN
    RAISE EXCEPTION 'no-concrete-report';
  END IF;

  INSERT INTO moderation_cases (
    target_type, target_id, reason_category, operator_identifier,
    action, outcome, identity_lookup_reason
  ) VALUES (
    'review', p_review_id, p_reason, p_operator_identifier,
    'identity-lookup', 'inspected', p_reason
  ) RETURNING moderation_cases.id INTO case_id;

  RETURN QUERY
  SELECT author_id, c.id, c.created_at, c.target_type, c.target_id,
         c.reason_category, c.operator_identifier, c.action, c.outcome,
         c.identity_lookup_reason
  FROM moderation_cases c WHERE c.id = case_id;
END;
$$;

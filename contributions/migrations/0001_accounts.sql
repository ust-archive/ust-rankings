CREATE TABLE contribution_users (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'onboarding'
    CHECK (status IN ('onboarding', 'active', 'suspended', 'closed')),
  public_display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (public_display_name IS NULL OR char_length(public_display_name) >= 1)
);

CREATE TABLE external_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL UNIQUE REFERENCES contribution_users(id),
  profile_name text,
  profile_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

CREATE FUNCTION prevent_external_identity_rebinding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.issuer <> OLD.issuer OR NEW.subject <> OLD.subject OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'External Identity bindings are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_identity_binding_immutable
BEFORE UPDATE OF issuer, subject, user_id ON external_identities
FOR EACH ROW EXECUTE FUNCTION prevent_external_identity_rebinding();

CREATE TABLE policy_acceptances (
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  policy text NOT NULL CHECK (policy IN ('privacy', 'community')),
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, policy, version)
);

CREATE INDEX policy_acceptances_user_id_idx ON policy_acceptances(user_id);

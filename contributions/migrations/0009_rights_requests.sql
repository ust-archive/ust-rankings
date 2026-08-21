CREATE TABLE rights_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  kind text NOT NULL CHECK (
    kind IN ('access', 'correction', 'withdrawal', 'closure', 'deletion')
  ),
  operator_identifier text NOT NULL CHECK (length(btrim(operator_identifier)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rights_requests_user_idx
ON rights_requests (user_id, created_at DESC);

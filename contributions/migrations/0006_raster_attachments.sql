CREATE TABLE stored_files (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES contribution_users(id),
  object_key text NOT NULL UNIQUE,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 33554432),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  detected_mime text NOT NULL CHECK (detected_mime IN (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, sha256)
);

CREATE INDEX stored_files_owner_idx ON stored_files (owner_user_id);

CREATE TABLE upload_intents (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES contribution_users(id),
  object_key text NOT NULL UNIQUE,
  declared_byte_size bigint NOT NULL CHECK (
    declared_byte_size > 0 AND declared_byte_size <= 33554432
  ),
  declared_extension text NOT NULL CHECK (declared_extension IN (
    'jpg', 'png', 'gif', 'webp', 'heic', 'heif'
  )),
  declared_mime text NOT NULL CHECK (declared_mime IN (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'
  )),
  state text NOT NULL CHECK (state IN (
    'reserved', 'uploaded', 'validating', 'accepted', 'rejected', 'validation_error'
  )),
  stored_file_id uuid REFERENCES stored_files(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state = 'accepted' AND stored_file_id IS NOT NULL)
    OR (state <> 'accepted' AND stored_file_id IS NULL)
  )
);

CREATE INDEX upload_intents_owner_state_idx
ON upload_intents (owner_user_id, state);
CREATE INDEX upload_intents_cleanup_idx
ON upload_intents (state, expires_at);

CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES review_revisions(id),
  stored_file_id uuid NOT NULL REFERENCES stored_files(id),
  public_filename text NOT NULL CHECK (
    char_length(public_filename) BETWEEN 1 AND 400
  ),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, stored_file_id)
);

CREATE INDEX attachments_revision_idx ON attachments (revision_id);
CREATE INDEX attachments_stored_file_idx ON attachments (stored_file_id);

CREATE FUNCTION prevent_attachment_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Attachments are immutable';
END;
$$;

CREATE TRIGGER attachments_immutable
BEFORE UPDATE OR DELETE ON attachments
FOR EACH ROW EXECUTE FUNCTION prevent_attachment_mutation();

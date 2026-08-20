ALTER TABLE stored_files
  ADD COLUMN IF NOT EXISTS removal_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

ALTER TABLE stored_files
  DROP CONSTRAINT IF EXISTS stored_files_owner_user_id_sha256_key;
CREATE UNIQUE INDEX IF NOT EXISTS stored_files_live_sha256_idx
  ON stored_files (owner_user_id, sha256) WHERE removed_at IS NULL;

ALTER TABLE stored_files
  DROP CONSTRAINT IF EXISTS stored_files_detected_mime_check;
ALTER TABLE stored_files
  ADD CONSTRAINT stored_files_detected_mime_check CHECK (detected_mime IN (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ));

ALTER TABLE stored_files
  DROP CONSTRAINT IF EXISTS stored_files_removal_state_check;
ALTER TABLE stored_files
  ADD CONSTRAINT stored_files_removal_state_check CHECK (
    removed_at IS NULL OR removal_requested_at IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS stored_files_removal_idx
ON stored_files (removal_requested_at)
WHERE removed_at IS NULL AND removal_requested_at IS NOT NULL;

ALTER TABLE upload_intents
  DROP CONSTRAINT IF EXISTS upload_intents_declared_extension_check;
ALTER TABLE upload_intents
  ADD CONSTRAINT upload_intents_declared_extension_check CHECK (
    declared_extension IN (
      'jpg', 'png', 'gif', 'webp', 'heic', 'heif',
      'pdf', 'txt', 'md', 'csv', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'
    )
  );

ALTER TABLE upload_intents
  DROP CONSTRAINT IF EXISTS upload_intents_declared_mime_check;
ALTER TABLE upload_intents
  ADD CONSTRAINT upload_intents_declared_mime_check CHECK (declared_mime IN (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ));

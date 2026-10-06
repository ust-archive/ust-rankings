ALTER TABLE upload_intents
  ADD COLUMN validation_lease_id uuid,
  ADD COLUMN validation_lease_expires_at timestamptz,
  ADD COLUMN validation_attempts integer NOT NULL DEFAULT 0
    CHECK (validation_attempts BETWEEN 0 AND 3),
  ADD COLUMN validation_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN accepted_reused boolean NOT NULL DEFAULT false;

-- Preserve pre-lease candidate keys until object deletion is confirmed.
UPDATE upload_intents SET validation_keys = ARRAY['verified/' || id]
WHERE state IN ('validating', 'validation_error', 'accepted');

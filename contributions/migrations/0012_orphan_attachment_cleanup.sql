ALTER TABLE stored_files
  ADD COLUMN last_upload_completed_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION require_available_stored_file() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM stored_files
  WHERE id = NEW.stored_file_id
    AND removal_requested_at IS NULL AND removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid-attachment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attachments_require_available_stored_file
BEFORE INSERT ON attachments
FOR EACH ROW EXECUTE FUNCTION require_available_stored_file();

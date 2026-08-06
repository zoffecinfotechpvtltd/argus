-- See sqlite migrations/0016_check_last_error.sql for the rationale.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS last_error_at TEXT;

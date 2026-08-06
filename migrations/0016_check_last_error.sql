-- A check's own failure reason (e.g. "system/status HTTP 403") was computed every poll but never
-- stored anywhere — logged nowhere, persisted nowhere. A secondary check (SNMP/HTTP/vendor API)
-- failing was completely invisible once aggregateChecks.ts stopped letting it drag the whole
-- device down. Plain nullable columns, added to the existing row rather than a new table.
ALTER TABLE checks ADD COLUMN last_error TEXT;
ALTER TABLE checks ADD COLUMN last_error_at TEXT;

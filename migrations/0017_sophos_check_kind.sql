-- Same gotcha as 0015_fortigate_check_kind.sql: SQLite can't ALTER a CHECK constraint in place, so
-- the table gets rebuilt with 'sophos_api' added to the allowed kind list. Schema copied verbatim
-- from 0015 (which already carried last_error/last_error_at forward via ALTER, not a rebuild — this
-- rebuild must include them too or they'd be silently dropped).
CREATE TABLE checks_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('icmp','tcp','http','snmp','fortigate_api','sophos_api')),
  config TEXT NOT NULL DEFAULT '{}',
  thresholds TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_error TEXT,
  last_error_at TEXT
);
INSERT INTO checks_new SELECT id, tenant_id, device_id, kind, config, thresholds, enabled, created_at, last_error, last_error_at FROM checks;
DROP TABLE checks;
ALTER TABLE checks_new RENAME TO checks;
CREATE INDEX IF NOT EXISTS idx_checks_tenant_device ON checks(tenant_id, device_id);

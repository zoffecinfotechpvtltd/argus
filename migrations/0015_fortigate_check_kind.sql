-- SQLite can't ALTER a CHECK constraint in place — rebuild the table with 'fortigate_api' added to
-- the allowed kind list. Schema copied verbatim from 0001_init.sql (no other migration has since
-- touched this table), so this is a pure constraint widening, nothing else changes.
CREATE TABLE checks_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('icmp','tcp','http','snmp','fortigate_api')),
  config TEXT NOT NULL DEFAULT '{}',
  thresholds TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
INSERT INTO checks_new SELECT id, tenant_id, device_id, kind, config, thresholds, enabled, created_at FROM checks;
DROP TABLE checks;
ALTER TABLE checks_new RENAME TO checks;
CREATE INDEX IF NOT EXISTS idx_checks_tenant_device ON checks(tenant_id, device_id);

-- Additive, backward-compatible schema for the enterprise-readiness pass (docs/improvement-plan/).
-- Every change here is a new nullable column, a new column with a safe default, or a brand-new
-- table — nothing existing is renamed or dropped, so this migration can never lose data.

-- Devices: free-form tags (asset/site/owner metadata) + an optional "this device sits behind that
-- device" uplink pointer, used by the alert engine to suppress downstream noise when the uplink
-- itself is down (see src/application/alertEngine.ts).
ALTER TABLE devices ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE devices ADD COLUMN uplink_device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_uplink ON devices(uplink_device_id);

-- Users: TOTP 2FA enrollment + per-account lockout (independent of the existing per-IP rate
-- limiter — see src/api/middleware/auth.ts).
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- Alert investigation notes — one row per comment, append-only like the audit log.
CREATE TABLE IF NOT EXISTS alert_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  alert_id TEXT NOT NULL,
  user_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_notes_alert ON alert_notes(tenant_id, alert_id, created_at);

-- Re-introduced API keys — same shape as the table `0007_remove_api_keys.sql` dropped, restored
-- deliberately narrow this time: read-only ("scopes" defaults to '["read"]' and every route that
-- accepts a key enforces GET-only regardless of what's stored here — see src/api/middleware/apiKey.ts).
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["read"]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_apikeys_tenant ON api_keys(tenant_id);

-- Scheduled/recurring discovery scans — the existing Discovery page's scan is always a manual
-- one-off; this lets an admin save a recurring profile that the scheduler below re-runs.
CREATE TABLE IF NOT EXISTS discovery_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  cidr TEXT NOT NULL,
  snmp_community_enc TEXT,
  recurrence TEXT NOT NULL,
  target_group_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_tenant ON discovery_schedules(tenant_id);

-- Per-user opt-in digest (daily/weekly summary email) alongside the existing real-time channels.
ALTER TABLE user_notification_prefs ADD COLUMN digest_recurrence TEXT;

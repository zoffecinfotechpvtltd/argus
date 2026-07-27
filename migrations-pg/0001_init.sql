-- Argus saas-mode (Postgres) schema — M0. Consolidated equivalent of the exe-mode SQLite schema
-- after migrations/0001..0009 (see SAAS_GAPS.md for the migration history this replays), written
-- fresh for Postgres rather than replaying the SQLite migration sequence verbatim, since exe mode
-- and saas mode are two different storage engines from day one in this schema's history, not one
-- database that grew a second dialect.
--
-- Dialect notes (deliberate choices, not oversights):
--  * IDs stay TEXT (app-generated UUIDs via randomUUID(), not native `uuid` type) — matches the
--    existing application/domain code exactly, no id-type translation layer needed in repos.
--  * Timestamps stay TEXT (ISO-8601 strings) — the Clock port (`src/ports/services.ts`) returns
--    strings everywhere (`nowIso()`), never Date objects; TIMESTAMPTZ would require a conversion
--    layer in every repo for no behavioral benefit here.
--  * JSON-shaped columns (config, thresholds, escalation_chain, tags, scopes, detail) use JSONB —
--    idiomatic Postgres, and the `pg` driver serializes/deserializes JS objects automatically, so
--    Postgres repos pass/receive plain objects instead of manual JSON.stringify/parse.
--  * Booleans are native BOOLEAN, not the SQLite 0/1-INTEGER convention.
--  * RULE (carried over from the SQLite schema's own header comment): every table carries
--    tenant_id and is indexed on (tenant_id, ...).

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  device_limit INTEGER NOT NULL DEFAULT 50,
  poller_limit INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  force_password_reset BOOLEAN NOT NULL DEFAULT FALSE,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TEXT,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user ON sessions(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS device_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  escalation_chain JSONB NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_tenant ON device_groups(tenant_id);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ip TEXT NOT NULL,
  mac TEXT,
  vendor TEXT,
  type TEXT NOT NULL DEFAULT 'unknown',
  location TEXT,
  group_id TEXT,
  responsible_user_id TEXT,
  interval_sec INTEGER NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  snmp_creds_enc TEXT,
  tags JSONB NOT NULL DEFAULT '[]',
  uplink_device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_tenant_ip ON devices(tenant_id, ip);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_group ON devices(tenant_id, group_id);
CREATE INDEX IF NOT EXISTS idx_devices_uplink ON devices(uplink_device_id);

CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('icmp','tcp','http','snmp')),
  config JSONB NOT NULL DEFAULT '{}',
  thresholds JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checks_tenant_device ON checks(tenant_id, device_id);

CREATE TABLE IF NOT EXISTS device_status (
  device_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'up' CHECK (state IN ('up','degraded','down','flapping','maintenance')),
  since TEXT NOT NULL,
  last_seen TEXT,
  last_latency_ms DOUBLE PRECISION,
  consecutive_fails INTEGER NOT NULL DEFAULT 0,
  consecutive_ok INTEGER NOT NULL DEFAULT 0,
  transition_log JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_status_tenant ON device_status(tenant_id);

CREATE TABLE IF NOT EXISTS metrics (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  check_id TEXT,
  ts TEXT NOT NULL,
  name TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_device_ts ON metrics(tenant_id, device_id, ts);
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);

CREATE TABLE IF NOT EXISTS metrics_hourly (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  check_id TEXT,
  ts_hour TEXT NOT NULL,
  name TEXT NOT NULL,
  avg_value DOUBLE PRECISION NOT NULL,
  min_value DOUBLE PRECISION NOT NULL,
  max_value DOUBLE PRECISION NOT NULL,
  sample_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_hourly_tenant_device_ts ON metrics_hourly(tenant_id, device_id, ts_hour);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  condition_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  title TEXT NOT NULL,
  detail TEXT,
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  acked_by TEXT,
  acked_at TEXT,
  resolved_at TEXT,
  escalation_step INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_status ON alerts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_device ON alerts(tenant_id, device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_open_condition ON alerts(tenant_id, device_id, condition_key)
  WHERE status != 'resolved';

CREATE TABLE IF NOT EXISTS notifications_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alert_id TEXT,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_log_tenant ON notifications_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT,
  group_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  recurrence TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_tenant ON maintenance_windows(tenant_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail JSONB,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '["read"]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_apikeys_tenant ON api_keys(tenant_id);

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  channels JSONB NOT NULL DEFAULT '["email"]',
  severity_floor TEXT NOT NULL DEFAULT 'warning',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  webhook_url TEXT,
  digest_recurrence TEXT
);

CREATE TABLE IF NOT EXISTS topology_positions (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, node_id)
);

CREATE TABLE IF NOT EXISTS device_state_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_state_history_tenant_device ON device_state_history(tenant_id, device_id, started_at);
CREATE INDEX IF NOT EXISTS idx_state_history_open ON device_state_history(device_id, ended_at);

CREATE TABLE IF NOT EXISTS alert_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  user_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_notes_alert ON alert_notes(tenant_id, alert_id, created_at);

CREATE TABLE IF NOT EXISTS discovery_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  cidr TEXT NOT NULL,
  snmp_community_enc TEXT,
  recurrence TEXT NOT NULL,
  target_group_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_tenant ON discovery_schedules(tenant_id);

-- Tracks which .sql files in migrations-pg/ have already been applied — same pattern as the
-- SQLite `schema_migrations` table (src/adapters/db/sqlite/connection.ts), separate table because
-- it's a different database, not because the concept differs.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

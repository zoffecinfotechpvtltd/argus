-- Phase 05: per-user topology node positions, and a durable state-transition history for SLA reporting
-- (device_status.transition_log is intentionally bounded for flap detection and isn't queryable history).

CREATE TABLE IF NOT EXISTS topology_positions (
  tenant_id TEXT NOT NULL DEFAULT 'local',
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, device_id)
);

CREATE TABLE IF NOT EXISTS device_state_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  device_id TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_state_history_tenant_device ON device_state_history(tenant_id, device_id, started_at);
CREATE INDEX IF NOT EXISTS idx_state_history_open ON device_state_history(device_id, ended_at);

-- See sqlite migrations/0019_remote_agents.sql for the rationale.
CREATE TABLE remote_agents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_remote_agents_tenant ON remote_agents(tenant_id);
CREATE UNIQUE INDEX idx_remote_agents_prefix ON remote_agents(token_prefix);

ALTER TABLE devices ADD COLUMN remote_agent_id TEXT;
CREATE INDEX idx_devices_remote_agent ON devices(remote_agent_id);

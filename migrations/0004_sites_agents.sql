-- Phase 08: remote agent/probe support for multi-site monitoring. Driver-agnostic SQL (SQLite
-- dialect; Postgres adapter translates at apply-time, same convention as prior migrations).

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  agent_token_hash TEXT NOT NULL,
  agent_token_prefix TEXT NOT NULL,
  probe_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'never_connected' CHECK (status IN ('online','offline','never_connected')),
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_agent_token_prefix ON sites(agent_token_prefix);

-- Which agent/site is responsible for polling a device. NULL = polled directly by the local
-- scheduler (exe mode's only mode of operation; saas mode's default for devices on a network the
-- cloud itself can already reach).
ALTER TABLE devices ADD COLUMN site_id TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_tenant_site ON devices(tenant_id, site_id);

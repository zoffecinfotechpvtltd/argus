-- Remote agents: a lightweight standalone poller process running inside a network segment the
-- central instance can't reach directly, pushing check results back over HTTPS. Deliberately its
-- own credential table, not api_keys — see the RemoteAgent doc comment in domain/entities.ts for
-- why (api_keys are documented and enforced GET-only; an agent needs one narrow write action).
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

-- NULL (the default) means "polled locally by this instance's own Scheduler" — unchanged for
-- every device that existed before remote agents did.
ALTER TABLE devices ADD COLUMN remote_agent_id TEXT;
CREATE INDEX idx_devices_remote_agent ON devices(remote_agent_id);

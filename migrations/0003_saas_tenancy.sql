-- Phase 08: multi-tenancy activation. Driver-agnostic SQL (SQLite dialect; Postgres adapter
-- translates at apply-time, same convention as 0001/0002).

ALTER TABLE users ADD COLUMN platform_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- exe-mode's single local admin (created via /api/setup) predates email verification and doesn't
-- need it — only SaaS-mode signups (which insert their own email_verified_at directly) are gated.
UPDATE users SET email_verified_at = created_at WHERE tenant_id = 'local';

CREATE TABLE IF NOT EXISTS tenant_usage (
  tenant_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  device_count INTEGER NOT NULL DEFAULT 0,
  notifications_sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month_key)
);

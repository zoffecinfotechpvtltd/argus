-- Removes the multi-tenant "SaaS mode" code path (remote agents/sites, tenant usage quotas,
-- platform-admin role) — this product ships as a single-tenant Windows exe only; SaaS mode was
-- never finished, tested, or launched. Driver-agnostic SQL, same convention as
-- 0005_remove_telegram.sql / 0007_remove_api_keys.sql. Does NOT touch the tenants table or
-- users.email_verified_at — both are still load-bearing for exe mode's single "local" tenant.

DROP INDEX IF EXISTS idx_devices_tenant_site;
ALTER TABLE devices DROP COLUMN site_id;

DROP INDEX IF EXISTS idx_sites_tenant;
DROP INDEX IF EXISTS idx_sites_agent_token_prefix;
DROP TABLE IF EXISTS sites;

DROP TABLE IF EXISTS tenant_usage;

ALTER TABLE users DROP COLUMN platform_admin;

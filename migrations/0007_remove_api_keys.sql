-- The public REST API (/api/v1/*) and its API Keys admin page were removed as a product-scope
-- decision — this is a UI-only product with no external integration surface. Driver-agnostic SQL,
-- same convention as 0005_remove_telegram.sql.

DROP TABLE IF EXISTS api_keys;

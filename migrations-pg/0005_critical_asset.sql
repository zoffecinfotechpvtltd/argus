-- Devices flagged critical (default off) skip the down-alert storm buffer and per-hour rate limit
-- entirely — they page immediately on every DOWN transition instead of waiting up to
-- stormWindowMs to see if it's part of a wider outage. Meant for devices whose downtime alone is
-- always actionable (cameras, firewalls), independent of what else on the network is doing.
ALTER TABLE devices ADD COLUMN critical_asset BOOLEAN NOT NULL DEFAULT FALSE;

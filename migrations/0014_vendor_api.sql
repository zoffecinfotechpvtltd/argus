-- Vendor identity facts (model/firmware/serial/HA role) learned from a vendor API poll (FortiGate
-- REST API, Sophos, ...) rather than typed in by an admin — populated by the scheduler when a
-- checker's CheckResult.deviceFacts comes back non-empty, read-only from the UI's perspective.
ALTER TABLE devices ADD COLUMN model TEXT;
ALTER TABLE devices ADD COLUMN firmware_version TEXT;
ALTER TABLE devices ADD COLUMN serial_number TEXT;
ALTER TABLE devices ADD COLUMN ha_role TEXT;

-- Which vendor REST API (if any) api_creds_enc's decrypted+parsed JSON should be interpreted as,
-- and which checker/CheckKind to auto-attach a check for. NULL means no vendor API is configured
-- for this device (SNMP/HTTP/ICMP checks are unaffected either way).
ALTER TABLE devices ADD COLUMN api_vendor TEXT;
ALTER TABLE devices ADD COLUMN api_creds_enc TEXT;

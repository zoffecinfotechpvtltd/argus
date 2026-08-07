-- See sqlite migrations/0017_sophos_check_kind.sql for the rationale. Postgres can widen a CHECK
-- constraint without a table rebuild.
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_kind_check;
ALTER TABLE checks ADD CONSTRAINT checks_kind_check CHECK (kind IN ('icmp','tcp','http','snmp','fortigate_api','sophos_api'));

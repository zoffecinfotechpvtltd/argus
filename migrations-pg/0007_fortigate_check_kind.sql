-- Postgres auto-names an unnamed CHECK constraint "<table>_<column>_check" — checks_kind_check is
-- that default for the constraint declared inline in 0001_init.sql. Widen it to allow the new
-- fortigate_api check kind.
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_kind_check;
ALTER TABLE checks ADD CONSTRAINT checks_kind_check CHECK (kind IN ('icmp','tcp','http','snmp','fortigate_api'));

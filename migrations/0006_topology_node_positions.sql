-- The map now lets you drag group/core nodes too, not just devices, so topology_positions needs
-- to key on any node id ("<deviceId>", "group:<groupId>", or "__core__"), not strictly a device.
ALTER TABLE topology_positions RENAME COLUMN device_id TO node_id;

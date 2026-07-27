-- M4: on-call rotation schedules, one per device group.
CREATE TABLE IF NOT EXISTS on_call_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  group_id TEXT NOT NULL,
  user_ids TEXT NOT NULL DEFAULT '[]',
  shift_length_hours INTEGER NOT NULL,
  rotation_start_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oncall_tenant_group ON on_call_schedules(tenant_id, group_id);

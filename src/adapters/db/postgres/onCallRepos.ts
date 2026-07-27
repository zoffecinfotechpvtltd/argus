import type { Pool } from "pg";
import type { OnCallSchedule } from "@domain/entities";
import type { OnCallScheduleRepo } from "@ports/repos";

function rowToOnCall(r: any): OnCallSchedule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    groupId: r.group_id,
    userIds: r.user_ids ?? [],
    shiftLengthHours: r.shift_length_hours,
    rotationStartAt: r.rotation_start_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class PgOnCallScheduleRepo implements OnCallScheduleRepo {
  constructor(private db: Pool) {}

  async create(s: OnCallSchedule): Promise<OnCallSchedule> {
    await this.db.query(
      `INSERT INTO on_call_schedules (id, tenant_id, group_id, user_ids, shift_length_hours, rotation_start_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.id, s.tenantId, s.groupId, JSON.stringify(s.userIds), s.shiftLengthHours, s.rotationStartAt, s.createdAt, s.updatedAt]
    );
    return s;
  }

  async update(tenantId: string, id: string, patch: Partial<OnCallSchedule>): Promise<OnCallSchedule | null> {
    const { rows } = await this.db.query("SELECT * FROM on_call_schedules WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    if (!rows[0]) return null;
    const merged = { ...rowToOnCall(rows[0]), ...patch };
    await this.db.query(
      `UPDATE on_call_schedules SET group_id=$1, user_ids=$2, shift_length_hours=$3, rotation_start_at=$4, updated_at=$5
       WHERE id=$6 AND tenant_id=$7`,
      [merged.groupId, JSON.stringify(merged.userIds), merged.shiftLengthHours, merged.rotationStartAt, new Date().toISOString(), id, tenantId]
    );
    const { rows: after } = await this.db.query("SELECT * FROM on_call_schedules WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return after[0] ? rowToOnCall(after[0]) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("DELETE FROM on_call_schedules WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return (res.rowCount ?? 0) > 0;
  }

  async findByGroup(tenantId: string, groupId: string): Promise<OnCallSchedule | null> {
    const { rows } = await this.db.query("SELECT * FROM on_call_schedules WHERE tenant_id=$1 AND group_id=$2", [tenantId, groupId]);
    return rows[0] ? rowToOnCall(rows[0]) : null;
  }

  async list(tenantId: string): Promise<OnCallSchedule[]> {
    const { rows } = await this.db.query("SELECT * FROM on_call_schedules WHERE tenant_id=$1 ORDER BY created_at DESC", [tenantId]);
    return rows.map(rowToOnCall);
  }
}

import type { Database } from "bun:sqlite";
import type { AlertNote, ApiKey, DiscoverySchedule, OnCallSchedule } from "@domain/entities";
import type { AlertNoteRepo, ApiKeyRepo, DiscoveryScheduleRepo, OnCallScheduleRepo } from "@ports/repos";

function rowToAlertNote(r: any): AlertNote {
  return { id: r.id, tenantId: r.tenant_id, alertId: r.alert_id, userId: r.user_id, body: r.body, createdAt: r.created_at };
}

export class SqliteAlertNoteRepo implements AlertNoteRepo {
  constructor(private db: Database) {}

  async create(n: AlertNote): Promise<AlertNote> {
    this.db
      .query<any, any>(
        `INSERT INTO alert_notes (id, tenant_id, alert_id, user_id, body, created_at)
         VALUES ($id,$tenant_id,$alert_id,$user_id,$body,$created_at)`
      )
      .run({ $id: n.id, $tenant_id: n.tenantId, $alert_id: n.alertId, $user_id: n.userId, $body: n.body, $created_at: n.createdAt });
    return n;
  }

  async listByAlert(tenantId: string, alertId: string): Promise<AlertNote[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM alert_notes WHERE tenant_id=$tenant_id AND alert_id=$alert_id ORDER BY created_at ASC")
      .all({ $tenant_id: tenantId, $alert_id: alertId }) as any[];
    return rows.map(rowToAlertNote);
  }
}

function rowToApiKey(r: any): ApiKey {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    keyHash: r.key_hash,
    keyPrefix: r.key_prefix,
    scopes: JSON.parse(r.scopes ?? '["read"]'),
    createdBy: r.created_by,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  };
}

export class SqliteApiKeyRepo implements ApiKeyRepo {
  constructor(private db: Database) {}

  async create(k: ApiKey): Promise<ApiKey> {
    this.db
      .query<any, any>(
        `INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, created_by, created_at, revoked_at, last_used_at)
         VALUES ($id,$tenant_id,$name,$key_hash,$key_prefix,$scopes,$created_by,$created_at,$revoked_at,$last_used_at)`
      )
      .run({
        $id: k.id,
        $tenant_id: k.tenantId,
        $name: k.name,
        $key_hash: k.keyHash,
        $key_prefix: k.keyPrefix,
        $scopes: JSON.stringify(k.scopes),
        $created_by: k.createdBy,
        $created_at: k.createdAt,
        $revoked_at: k.revokedAt,
        $last_used_at: k.lastUsedAt,
      });
    return k;
  }

  async revoke(tenantId: string, id: string): Promise<boolean> {
    const res = this.db
      .query<any, any>("UPDATE api_keys SET revoked_at=$now WHERE id=$id AND tenant_id=$tenant_id AND revoked_at IS NULL")
      .run({ $id: id, $tenant_id: tenantId, $now: new Date().toISOString() });
    return res.changes > 0;
  }

  async list(tenantId: string): Promise<ApiKey[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM api_keys WHERE tenant_id=$tenant_id ORDER BY created_at DESC")
      .all({ $tenant_id: tenantId }) as any[];
    return rows.map(rowToApiKey);
  }

  async findByPrefix(prefix: string): Promise<ApiKey | null> {
    const row = this.db.query<any, any>("SELECT * FROM api_keys WHERE key_prefix=$prefix").get({ $prefix: prefix });
    return row ? rowToApiKey(row) : null;
  }

  async touchLastUsed(id: string, atIso: string): Promise<void> {
    this.db.query<any, any>("UPDATE api_keys SET last_used_at=$at WHERE id=$id").run({ $id: id, $at: atIso });
  }
}

function rowToDiscoverySchedule(r: any): DiscoverySchedule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    cidr: r.cidr,
    snmpCredsEnc: r.snmp_community_enc,
    recurrence: r.recurrence,
    targetGroupId: r.target_group_id,
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export class SqliteDiscoveryScheduleRepo implements DiscoveryScheduleRepo {
  constructor(private db: Database) {}

  async create(s: DiscoverySchedule): Promise<DiscoverySchedule> {
    this.db
      .query<any, any>(
        `INSERT INTO discovery_schedules (id, tenant_id, cidr, snmp_community_enc, recurrence, target_group_id, enabled, last_run_at, next_run_at, created_by, created_at)
         VALUES ($id,$tenant_id,$cidr,$snmp,$recurrence,$group,$enabled,$last_run,$next_run,$created_by,$created_at)`
      )
      .run({
        $id: s.id,
        $tenant_id: s.tenantId,
        $cidr: s.cidr,
        $snmp: s.snmpCredsEnc,
        $recurrence: s.recurrence,
        $group: s.targetGroupId,
        $enabled: s.enabled ? 1 : 0,
        $last_run: s.lastRunAt,
        $next_run: s.nextRunAt,
        $created_by: s.createdBy,
        $created_at: s.createdAt,
      });
    return s;
  }

  async update(tenantId: string, id: string, patch: Partial<DiscoverySchedule>): Promise<DiscoverySchedule | null> {
    const existing = this.db
      .query<any, any>("SELECT * FROM discovery_schedules WHERE id=$id AND tenant_id=$tenant_id")
      .get({ $id: id, $tenant_id: tenantId });
    if (!existing) return null;
    const merged = { ...rowToDiscoverySchedule(existing), ...patch };
    this.db
      .query<any, any>(
        `UPDATE discovery_schedules SET cidr=$cidr, snmp_community_enc=$snmp, recurrence=$recurrence,
         target_group_id=$group, enabled=$enabled, last_run_at=$last_run, next_run_at=$next_run
         WHERE id=$id AND tenant_id=$tenant_id`
      )
      .run({
        $id: id,
        $tenant_id: tenantId,
        $cidr: merged.cidr,
        $snmp: merged.snmpCredsEnc,
        $recurrence: merged.recurrence,
        $group: merged.targetGroupId,
        $enabled: merged.enabled ? 1 : 0,
        $last_run: merged.lastRunAt,
        $next_run: merged.nextRunAt,
      });
    return merged;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = this.db
      .query<any, any>("DELETE FROM discovery_schedules WHERE id=$id AND tenant_id=$tenant_id")
      .run({ $id: id, $tenant_id: tenantId });
    return res.changes > 0;
  }

  async list(tenantId: string): Promise<DiscoverySchedule[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM discovery_schedules WHERE tenant_id=$tenant_id ORDER BY created_at DESC")
      .all({ $tenant_id: tenantId }) as any[];
    return rows.map(rowToDiscoverySchedule);
  }

  async listDue(atIso: string): Promise<DiscoverySchedule[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM discovery_schedules WHERE enabled=1 AND next_run_at <= $at")
      .all({ $at: atIso }) as any[];
    return rows.map(rowToDiscoverySchedule);
  }
}

function rowToOnCall(r: any): OnCallSchedule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    groupId: r.group_id,
    userIds: JSON.parse(r.user_ids ?? "[]"),
    shiftLengthHours: r.shift_length_hours,
    rotationStartAt: r.rotation_start_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class SqliteOnCallScheduleRepo implements OnCallScheduleRepo {
  constructor(private db: Database) {}

  async create(s: OnCallSchedule): Promise<OnCallSchedule> {
    this.db
      .query<any, any>(
        `INSERT INTO on_call_schedules (id, tenant_id, group_id, user_ids, shift_length_hours, rotation_start_at, created_at, updated_at)
         VALUES ($id,$tenant_id,$group_id,$user_ids,$shift_length_hours,$rotation_start_at,$created_at,$updated_at)`
      )
      .run({
        $id: s.id,
        $tenant_id: s.tenantId,
        $group_id: s.groupId,
        $user_ids: JSON.stringify(s.userIds),
        $shift_length_hours: s.shiftLengthHours,
        $rotation_start_at: s.rotationStartAt,
        $created_at: s.createdAt,
        $updated_at: s.updatedAt,
      });
    return s;
  }

  async update(tenantId: string, id: string, patch: Partial<OnCallSchedule>): Promise<OnCallSchedule | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    this.db
      .query<any, any>(
        `UPDATE on_call_schedules SET group_id=$group_id, user_ids=$user_ids, shift_length_hours=$shift_length_hours,
         rotation_start_at=$rotation_start_at, updated_at=$updated_at WHERE id=$id AND tenant_id=$tenant_id`
      )
      .run({
        $id: id,
        $tenant_id: tenantId,
        $group_id: merged.groupId,
        $user_ids: JSON.stringify(merged.userIds),
        $shift_length_hours: merged.shiftLengthHours,
        $rotation_start_at: merged.rotationStartAt,
        $updated_at: new Date().toISOString(),
      });
    return this.findById(tenantId, id);
  }

  private async findById(tenantId: string, id: string): Promise<OnCallSchedule | null> {
    const row = this.db.query<any, any>("SELECT * FROM on_call_schedules WHERE id=$id AND tenant_id=$tenant_id").get({ $id: id, $tenant_id: tenantId });
    return row ? rowToOnCall(row) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = this.db
      .query<any, any>("DELETE FROM on_call_schedules WHERE id=$id AND tenant_id=$tenant_id")
      .run({ $id: id, $tenant_id: tenantId });
    return res.changes > 0;
  }

  async findByGroup(tenantId: string, groupId: string): Promise<OnCallSchedule | null> {
    const row = this.db
      .query<any, any>("SELECT * FROM on_call_schedules WHERE tenant_id=$tenant_id AND group_id=$group_id")
      .get({ $tenant_id: tenantId, $group_id: groupId });
    return row ? rowToOnCall(row) : null;
  }

  async list(tenantId: string): Promise<OnCallSchedule[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM on_call_schedules WHERE tenant_id=$tenant_id ORDER BY created_at DESC")
      .all({ $tenant_id: tenantId }) as any[];
    return rows.map(rowToOnCall);
  }
}

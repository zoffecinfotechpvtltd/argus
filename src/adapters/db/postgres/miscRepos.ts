import type { Pool } from "pg";
import type { AuditLogEntry, MaintenanceWindow, NotificationPrefs } from "@domain/entities";
import type { AuditRepo, MaintenanceRepo, NotificationPrefsRepo, Page, SettingsRepo } from "@ports/repos";

export class PgSettingsRepo implements SettingsRepo {
  constructor(private db: Pool) {}

  async get(tenantId: string, key: string): Promise<string | null> {
    const { rows } = await this.db.query("SELECT value FROM settings WHERE tenant_id=$1 AND key=$2", [tenantId, key]);
    return rows[0] ? rows[0].value : null;
  }

  async set(tenantId: string, key: string, value: string): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value=excluded.value`,
      [tenantId, key, value]
    );
  }

  async getAll(tenantId: string): Promise<Record<string, string>> {
    const { rows } = await this.db.query("SELECT key, value FROM settings WHERE tenant_id=$1", [tenantId]);
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
}

export class PgAuditRepo implements AuditRepo {
  constructor(private db: Pool) {}

  async record(e: AuditLogEntry): Promise<void> {
    await this.db.query(
      "INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [e.tenantId, e.userId, e.action, e.entityType, e.entityId, e.detail ? JSON.stringify(e.detail) : null, e.createdAt]
    );
  }

  async list(
    tenantId: string,
    filter: {
      userId?: string;
      action?: string;
      entityType?: string;
      entityId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<Page<AuditLogEntry>> {
    const clauses = ["tenant_id=$1"];
    const params: unknown[] = [tenantId];
    if (filter.userId) {
      params.push(filter.userId);
      clauses.push(`user_id=$${params.length}`);
    }
    if (filter.action) {
      params.push(filter.action);
      clauses.push(`action=$${params.length}`);
    }
    if (filter.entityType) {
      params.push(filter.entityType);
      clauses.push(`entity_type=$${params.length}`);
    }
    if (filter.entityId) {
      params.push(filter.entityId);
      clauses.push(`entity_id=$${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      clauses.push(`created_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      clauses.push(`created_at <= $${params.length}`);
    }
    const where = clauses.join(" AND ");
    const totalRes = await this.db.query(`SELECT COUNT(*)::int as c FROM audit_log WHERE ${where}`, params);
    const limit = filter.limit ?? 200;
    const offset = filter.offset ?? 0;
    const rowsRes = await this.db.query(
      `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return {
      items: rowsRes.rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        userId: r.user_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        detail: r.detail ?? null,
        createdAt: r.created_at,
      })),
      total: totalRes.rows[0].c,
    };
  }
}

function rowToMaint(r: any): MaintenanceWindow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    deviceId: r.device_id,
    groupId: r.group_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    recurrence: r.recurrence,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export class PgMaintenanceRepo implements MaintenanceRepo {
  constructor(private db: Pool) {}

  async create(w: MaintenanceWindow): Promise<MaintenanceWindow> {
    await this.db.query(
      `INSERT INTO maintenance_windows (id, tenant_id, device_id, group_id, starts_at, ends_at, recurrence, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [w.id, w.tenantId, w.deviceId, w.groupId, w.startsAt, w.endsAt, w.recurrence, w.createdBy, w.createdAt]
    );
    return w;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("DELETE FROM maintenance_windows WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return (res.rowCount ?? 0) > 0;
  }

  // Same reasoning as SqliteMaintenanceRepo.listActive (src/adapters/db/sqlite/miscRepos.ts): only
  // filters windows that haven't started yet at all — recurrence expansion needs the full row and
  // happens in @domain/maintenance.ts's isWindowActiveAt, not here.
  async listActive(tenantId: string, atIso: string): Promise<MaintenanceWindow[]> {
    const { rows } = await this.db.query("SELECT * FROM maintenance_windows WHERE tenant_id=$1 AND starts_at <= $2", [tenantId, atIso]);
    return rows.map(rowToMaint);
  }

  async list(tenantId: string): Promise<MaintenanceWindow[]> {
    const { rows } = await this.db.query("SELECT * FROM maintenance_windows WHERE tenant_id=$1 ORDER BY starts_at DESC", [tenantId]);
    return rows.map(rowToMaint);
  }
}

function rowToPrefs(r: any): NotificationPrefs {
  return {
    userId: r.user_id,
    tenantId: r.tenant_id,
    channels: r.channels ?? [],
    severityFloor: r.severity_floor,
    quietHoursStart: r.quiet_hours_start,
    quietHoursEnd: r.quiet_hours_end,
    webhookUrl: r.webhook_url,
    digestRecurrence: r.digest_recurrence ?? null,
  };
}

export class PgNotificationPrefsRepo implements NotificationPrefsRepo {
  constructor(private db: Pool) {}

  async get(tenantId: string, userId: string): Promise<NotificationPrefs | null> {
    const { rows } = await this.db.query("SELECT * FROM user_notification_prefs WHERE user_id=$1 AND tenant_id=$2", [userId, tenantId]);
    return rows[0] ? rowToPrefs(rows[0]) : null;
  }

  async upsert(p: NotificationPrefs): Promise<void> {
    await this.db.query(
      `INSERT INTO user_notification_prefs (user_id, tenant_id, channels, severity_floor, quiet_hours_start, quiet_hours_end, webhook_url, digest_recurrence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id) DO UPDATE SET channels=excluded.channels, severity_floor=excluded.severity_floor,
         quiet_hours_start=excluded.quiet_hours_start, quiet_hours_end=excluded.quiet_hours_end,
         webhook_url=excluded.webhook_url, digest_recurrence=excluded.digest_recurrence`,
      [p.userId, p.tenantId, JSON.stringify(p.channels), p.severityFloor, p.quietHoursStart, p.quietHoursEnd, p.webhookUrl, p.digestRecurrence ?? null]
    );
  }

  /** Cross-tenant — the digest scheduler ticks once for every user with an opt-in digest, not per-tenant. */
  async listWithDigest(): Promise<NotificationPrefs[]> {
    const { rows } = await this.db.query("SELECT * FROM user_notification_prefs WHERE digest_recurrence IS NOT NULL");
    return rows.map(rowToPrefs);
  }
}

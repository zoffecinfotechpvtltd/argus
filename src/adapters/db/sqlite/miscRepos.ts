import type { Database } from "bun:sqlite";
import type { AuditLogEntry, MaintenanceWindow, NotificationPrefs } from "@domain/entities";
import type { AuditRepo, MaintenanceRepo, NotificationPrefsRepo, Page, SettingsRepo } from "@ports/repos";

export class SqliteSettingsRepo implements SettingsRepo {
  constructor(private db: Database) {}

  async get(tenantId: string, key: string): Promise<string | null> {
    const row = this.db
      .query<any, any>("SELECT value FROM settings WHERE tenant_id=$tenant_id AND key=$key")
      .get({ $tenant_id: tenantId, $key: key }) as any;
    return row ? row.value : null;
  }

  async set(tenantId: string, key: string, value: string): Promise<void> {
    this.db
      .query<any, any>(
        `INSERT INTO settings (tenant_id, key, value) VALUES ($tenant_id,$key,$value)
         ON CONFLICT(tenant_id, key) DO UPDATE SET value=excluded.value`
      )
      .run({ $tenant_id: tenantId, $key: key, $value: value });
  }

  async getAll(tenantId: string): Promise<Record<string, string>> {
    const rows = this.db.query<any, any>("SELECT key, value FROM settings WHERE tenant_id=$tenant_id").all({ $tenant_id: tenantId }) as any[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
}

export class SqliteAuditRepo implements AuditRepo {
  constructor(private db: Database) {}

  async record(e: AuditLogEntry): Promise<void> {
    this.db
      .query<any, any>(
        `INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, detail, created_at)
         VALUES ($tenant_id,$user_id,$action,$entity_type,$entity_id,$detail,$created_at)`
      )
      .run({
        $tenant_id: e.tenantId,
        $user_id: e.userId,
        $action: e.action,
        $entity_type: e.entityType,
        $entity_id: e.entityId,
        $detail: e.detail ? JSON.stringify(e.detail) : null,
        $created_at: e.createdAt,
      });
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
    const clauses = ["tenant_id=$tenant_id"];
    const params: Record<string, unknown> = { $tenant_id: tenantId };
    if (filter.userId) {
      clauses.push("user_id=$user_id");
      params.$user_id = filter.userId;
    }
    if (filter.action) {
      clauses.push("action=$action");
      params.$action = filter.action;
    }
    if (filter.entityType) {
      clauses.push("entity_type=$entity_type");
      params.$entity_type = filter.entityType;
    }
    if (filter.entityId) {
      clauses.push("entity_id=$entity_id");
      params.$entity_id = filter.entityId;
    }
    if (filter.from) {
      clauses.push("created_at >= $from");
      params.$from = filter.from;
    }
    if (filter.to) {
      clauses.push("created_at <= $to");
      params.$to = filter.to;
    }
    const where = clauses.join(" AND ");
    const total = (this.db.query<any, any>(`SELECT COUNT(*) as c FROM audit_log WHERE ${where}`).get(params) as any).c as number;
    const limit = filter.limit ?? 200;
    const offset = filter.offset ?? 0;
    const rows = this.db
      .query<any, any>(`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`)
      .all(params) as any[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        userId: r.user_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        detail: r.detail ? JSON.parse(r.detail) : null,
        createdAt: r.created_at,
      })),
      total,
    };
  }
}

export class SqliteMaintenanceRepo implements MaintenanceRepo {
  constructor(private db: Database) {}

  async create(w: MaintenanceWindow): Promise<MaintenanceWindow> {
    this.db
      .query<any, any>(
        `INSERT INTO maintenance_windows (id, tenant_id, device_id, group_id, starts_at, ends_at, recurrence, created_by, created_at)
         VALUES ($id,$tenant_id,$device_id,$group_id,$starts_at,$ends_at,$recurrence,$created_by,$created_at)`
      )
      .run({
        $id: w.id,
        $tenant_id: w.tenantId,
        $device_id: w.deviceId,
        $group_id: w.groupId,
        $starts_at: w.startsAt,
        $ends_at: w.endsAt,
        $recurrence: w.recurrence,
        $created_by: w.createdBy,
        $created_at: w.createdAt,
      });
    return w;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = this.db
      .query<any, any>("DELETE FROM maintenance_windows WHERE id=$id AND tenant_id=$tenant_id")
      .run({ $id: id, $tenant_id: tenantId });
    return res.changes > 0;
  }

  /** `atIso` is unused in the query itself — recurring windows need `@domain/maintenance.ts`'s
   * `isWindowActiveAt` to expand the recurrence, which needs the *whole* window row, not a
   * pre-filtered one. This still only excludes windows that haven't started yet at all
   * (`starts_at <= $at`), which every recurrence — including "none" — always requires. */
  async listActive(tenantId: string, atIso: string): Promise<MaintenanceWindow[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM maintenance_windows WHERE tenant_id=$tenant_id AND starts_at <= $at")
      .all({ $tenant_id: tenantId, $at: atIso }) as any[];
    return rows.map(mapMaint);
  }

  async list(tenantId: string): Promise<MaintenanceWindow[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM maintenance_windows WHERE tenant_id=$tenant_id ORDER BY starts_at DESC")
      .all({ $tenant_id: tenantId }) as any[];
    return rows.map(mapMaint);
  }
}

function mapMaint(r: any): MaintenanceWindow {
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

export class SqliteNotificationPrefsRepo implements NotificationPrefsRepo {
  constructor(private db: Database) {}

  async get(tenantId: string, userId: string): Promise<NotificationPrefs | null> {
    const row = this.db
      .query<any, any>("SELECT * FROM user_notification_prefs WHERE user_id=$user_id AND tenant_id=$tenant_id")
      .get({ $user_id: userId, $tenant_id: tenantId }) as any;
    if (!row) return null;
    return {
      userId: row.user_id,
      tenantId: row.tenant_id,
      channels: JSON.parse(row.channels ?? "[]"),
      severityFloor: row.severity_floor,
      quietHoursStart: row.quiet_hours_start,
      quietHoursEnd: row.quiet_hours_end,
      webhookUrl: row.webhook_url,
      slackWebhookUrl: row.slack_webhook_url ?? null,
      teamsWebhookUrl: row.teams_webhook_url ?? null,
      pagerdutyRoutingKey: row.pagerduty_routing_key ?? null,
      digestRecurrence: row.digest_recurrence ?? null,
    };
  }

  async upsert(p: NotificationPrefs): Promise<void> {
    this.db
      .query<any, any>(
        `INSERT INTO user_notification_prefs (user_id, tenant_id, channels, severity_floor, quiet_hours_start, quiet_hours_end, webhook_url, slack_webhook_url, teams_webhook_url, pagerduty_routing_key, digest_recurrence)
         VALUES ($user_id,$tenant_id,$channels,$severity_floor,$qs,$qe,$webhook,$slack,$teams,$pagerduty,$digest)
         ON CONFLICT(user_id) DO UPDATE SET channels=excluded.channels, severity_floor=excluded.severity_floor,
           quiet_hours_start=excluded.quiet_hours_start, quiet_hours_end=excluded.quiet_hours_end,
           webhook_url=excluded.webhook_url, slack_webhook_url=excluded.slack_webhook_url,
           teams_webhook_url=excluded.teams_webhook_url, pagerduty_routing_key=excluded.pagerduty_routing_key,
           digest_recurrence=excluded.digest_recurrence`
      )
      .run({
        $user_id: p.userId,
        $tenant_id: p.tenantId,
        $channels: JSON.stringify(p.channels),
        $severity_floor: p.severityFloor,
        $qs: p.quietHoursStart,
        $qe: p.quietHoursEnd,
        $webhook: p.webhookUrl,
        $slack: p.slackWebhookUrl,
        $teams: p.teamsWebhookUrl,
        $pagerduty: p.pagerdutyRoutingKey,
        $digest: p.digestRecurrence ?? null,
      });
  }

  /** Cross-tenant — the digest scheduler ticks once for every user with an opt-in digest, not per-tenant. */
  async listWithDigest(): Promise<NotificationPrefs[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM user_notification_prefs WHERE digest_recurrence IS NOT NULL")
      .all() as any[];
    return rows.map((row) => ({
      userId: row.user_id,
      tenantId: row.tenant_id,
      channels: JSON.parse(row.channels ?? "[]"),
      severityFloor: row.severity_floor,
      quietHoursStart: row.quiet_hours_start,
      quietHoursEnd: row.quiet_hours_end,
      webhookUrl: row.webhook_url,
      slackWebhookUrl: row.slack_webhook_url ?? null,
      teamsWebhookUrl: row.teams_webhook_url ?? null,
      pagerdutyRoutingKey: row.pagerduty_routing_key ?? null,
      digestRecurrence: row.digest_recurrence ?? null,
    }));
  }
}

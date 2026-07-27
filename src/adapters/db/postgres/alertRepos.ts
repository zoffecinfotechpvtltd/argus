import type { Pool } from "pg";
import type { Alert, AlertNote, NotificationLogEntry } from "@domain/entities";
import type { AlertFilter, AlertNoteRepo, AlertRepo, NotificationLogRepo, Page } from "@ports/repos";

function rowToAlert(r: any): Alert {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    deviceId: r.device_id,
    conditionKey: r.condition_key,
    severity: r.severity,
    status: r.status,
    title: r.title,
    detail: r.detail,
    openedAt: r.opened_at,
    lastSeenAt: r.last_seen_at,
    ackedBy: r.acked_by,
    ackedAt: r.acked_at,
    resolvedAt: r.resolved_at,
    escalationStep: r.escalation_step,
  };
}

export class PgAlertRepo implements AlertRepo {
  constructor(private db: Pool) {}

  async create(a: Alert): Promise<Alert> {
    await this.db.query(
      `INSERT INTO alerts (id, tenant_id, device_id, condition_key, severity, status, title, detail, opened_at, last_seen_at, acked_by, acked_at, resolved_at, escalation_step)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        a.id,
        a.tenantId,
        a.deviceId,
        a.conditionKey,
        a.severity,
        a.status,
        a.title,
        a.detail,
        a.openedAt,
        a.lastSeenAt,
        a.ackedBy,
        a.ackedAt,
        a.resolvedAt,
        a.escalationStep,
      ]
    );
    return a;
  }

  async update(tenantId: string, id: string, patch: Partial<Alert>): Promise<Alert | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.db.query(
      `UPDATE alerts SET severity=$1, status=$2, title=$3, detail=$4, last_seen_at=$5,
       acked_by=$6, acked_at=$7, resolved_at=$8, escalation_step=$9 WHERE id=$10 AND tenant_id=$11`,
      [merged.severity, merged.status, merged.title, merged.detail, merged.lastSeenAt, merged.ackedBy, merged.ackedAt, merged.resolvedAt, merged.escalationStep, id, tenantId]
    );
    return this.findById(tenantId, id);
  }

  async findById(tenantId: string, id: string): Promise<Alert | null> {
    const { rows } = await this.db.query("SELECT * FROM alerts WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return rows[0] ? rowToAlert(rows[0]) : null;
  }

  async findByIdAnyTenant(id: string): Promise<Alert | null> {
    const { rows } = await this.db.query("SELECT * FROM alerts WHERE id=$1", [id]);
    return rows[0] ? rowToAlert(rows[0]) : null;
  }

  async findOpenByCondition(tenantId: string, deviceId: string, conditionKey: string): Promise<Alert | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM alerts WHERE tenant_id=$1 AND device_id=$2 AND condition_key=$3 AND status != 'resolved'`,
      [tenantId, deviceId, conditionKey]
    );
    return rows[0] ? rowToAlert(rows[0]) : null;
  }

  async list(tenantId: string, filter: AlertFilter = {}): Promise<Page<Alert>> {
    const clauses = ["tenant_id=$1"];
    const params: unknown[] = [tenantId];
    if (filter.status) {
      params.push(filter.status);
      clauses.push(`status=$${params.length}`);
    }
    if (filter.severity) {
      params.push(filter.severity);
      clauses.push(`severity=$${params.length}`);
    }
    if (filter.deviceId) {
      params.push(filter.deviceId);
      clauses.push(`device_id=$${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      clauses.push(`opened_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      clauses.push(`opened_at <= $${params.length}`);
    }
    const where = clauses.join(" AND ");
    const totalRes = await this.db.query(`SELECT COUNT(*)::int as c FROM alerts WHERE ${where}`, params);
    const limit = filter.limit ?? 200;
    const offset = filter.offset ?? 0;
    const rowsRes = await this.db.query(
      `SELECT * FROM alerts WHERE ${where} ORDER BY opened_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { items: rowsRes.rows.map(rowToAlert), total: totalRes.rows[0].c };
  }

  async listOpenUnacked(): Promise<Alert[]> {
    const { rows } = await this.db.query(`SELECT * FROM alerts WHERE status = 'open'`);
    return rows.map(rowToAlert);
  }

  async countOpenBySeverity(tenantId: string): Promise<Record<string, number>> {
    const { rows } = await this.db.query(
      `SELECT severity, COUNT(*)::int as c FROM alerts WHERE tenant_id=$1 AND status='open' GROUP BY severity`,
      [tenantId]
    );
    const out: Record<string, number> = { info: 0, warning: 0, critical: 0 };
    for (const r of rows as Array<{ severity: string; c: number }>) out[r.severity] = r.c;
    return out;
  }

  async countByDayAndSeverity(tenantId: string, fromIso: string, toIso: string): Promise<Array<{ day: string; severity: string; count: number }>> {
    const { rows } = await this.db.query(
      `SELECT LEFT(opened_at, 10) as day, severity, COUNT(*)::int as c FROM alerts
       WHERE tenant_id=$1 AND opened_at >= $2 AND opened_at <= $3
       GROUP BY day, severity ORDER BY day`,
      [tenantId, fromIso, toIso]
    );
    return (rows as Array<{ day: string; severity: string; c: number }>).map((r) => ({ day: r.day, severity: r.severity, count: r.c }));
  }

  async claimEscalationStep(tenantId: string, id: string, expectedStep: number, newStep: number): Promise<boolean> {
    const res = await this.db.query("UPDATE alerts SET escalation_step=$1 WHERE id=$2 AND tenant_id=$3 AND escalation_step=$4", [
      newStep,
      id,
      tenantId,
      expectedStep,
    ]);
    return (res.rowCount ?? 0) > 0;
  }
}

export class PgNotificationLogRepo implements NotificationLogRepo {
  constructor(private db: Pool) {}

  async record(e: NotificationLogEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO notifications_log (tenant_id, alert_id, channel, target, status, error, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.tenantId, e.alertId, e.channel, e.target, e.status, e.error, e.createdAt]
    );
  }

  async list(tenantId: string, limit = 200): Promise<NotificationLogEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM notifications_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit]
    );
    return rows.map((r: any) => ({
      tenantId: r.tenant_id,
      alertId: r.alert_id,
      channel: r.channel,
      target: r.target,
      status: r.status,
      error: r.error,
      createdAt: r.created_at,
    }));
  }

  async listByAlert(tenantId: string, alertId: string): Promise<NotificationLogEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM notifications_log WHERE tenant_id=$1 AND alert_id=$2 ORDER BY created_at ASC`,
      [tenantId, alertId]
    );
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      alertId: r.alert_id,
      channel: r.channel,
      target: r.target,
      status: r.status,
      error: r.error,
      createdAt: r.created_at,
    }));
  }
}

export class PgAlertNoteRepo implements AlertNoteRepo {
  constructor(private db: Pool) {}

  async create(n: AlertNote): Promise<AlertNote> {
    await this.db.query(`INSERT INTO alert_notes (id, tenant_id, alert_id, user_id, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [
      n.id,
      n.tenantId,
      n.alertId,
      n.userId,
      n.body,
      n.createdAt,
    ]);
    return n;
  }

  async listByAlert(tenantId: string, alertId: string): Promise<AlertNote[]> {
    const { rows } = await this.db.query("SELECT * FROM alert_notes WHERE tenant_id=$1 AND alert_id=$2 ORDER BY created_at ASC", [tenantId, alertId]);
    return rows.map((r: any) => ({ id: r.id, tenantId: r.tenant_id, alertId: r.alert_id, userId: r.user_id, body: r.body, createdAt: r.created_at }));
  }
}

import type { Database } from "bun:sqlite";
import type { Alert, Metric, NotificationLogEntry } from "@domain/entities";
import type { AlertFilter, AlertRepo, MetricQuery, MetricRepo, NotificationLogRepo, Page } from "@ports/repos";
import { percentile95 } from "@domain/metricsMath";

export class SqliteMetricRepo implements MetricRepo {
  constructor(private db: Database) {}

  async insertBatch(metrics: Metric[]): Promise<void> {
    if (metrics.length === 0) return;
    const stmt = this.db.query<any, any>(
      `INSERT INTO metrics (tenant_id, device_id, check_id, ts, name, value) VALUES ($tenant_id,$device_id,$check_id,$ts,$name,$value)`
    );
    const tx = this.db.transaction((rows: Metric[]) => {
      for (const m of rows) {
        stmt.run({
          $tenant_id: m.tenantId,
          $device_id: m.deviceId,
          $check_id: m.checkId,
          $ts: m.ts,
          $name: m.name,
          $value: m.value,
        });
      }
    });
    tx(metrics);
  }

  async queryRaw(tenantId: string, q: MetricQuery): Promise<Metric[]> {
    const clauses = ["tenant_id=$tenant_id", "device_id=$device_id", "ts >= $from", "ts <= $to"];
    const params: Record<string, unknown> = { $tenant_id: tenantId, $device_id: q.deviceId, $from: q.from, $to: q.to };
    if (q.name) {
      clauses.push("name=$name");
      params.$name = q.name;
    }
    const rows = this.db
      .query<any, any>(`SELECT * FROM metrics WHERE ${clauses.join(" AND ")} ORDER BY ts ASC`)
      .all(params) as any[];
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      checkId: r.check_id,
      ts: r.ts,
      name: r.name,
      value: r.value,
    }));
  }

  async queryHourly(tenantId: string, q: MetricQuery): Promise<Metric[]> {
    const clauses = ["tenant_id=$tenant_id", "device_id=$device_id", "ts_hour >= $from", "ts_hour <= $to"];
    const params: Record<string, unknown> = { $tenant_id: tenantId, $device_id: q.deviceId, $from: q.from, $to: q.to };
    if (q.name) {
      clauses.push("name=$name");
      params.$name = q.name;
    }
    const rows = this.db
      .query<any, any>(`SELECT * FROM metrics_hourly WHERE ${clauses.join(" AND ")} ORDER BY ts_hour ASC`)
      .all(params) as any[];
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      checkId: r.check_id,
      ts: r.ts_hour,
      name: r.name,
      value: r.avg_value,
    }));
  }

  async rollupHour(tenantId: string, hourIso: string): Promise<number> {
    const hourStart = hourIso;
    const hourEnd = new Date(new Date(hourIso).getTime() + 3600_000).toISOString();
    const rows = this.db
      .query<any, any>(
        `SELECT device_id, check_id, name, AVG(value) as avg_v, MIN(value) as min_v, MAX(value) as max_v, COUNT(*) as cnt
         FROM metrics WHERE tenant_id=$tenant_id AND ts >= $start AND ts < $end
         GROUP BY device_id, check_id, name`
      )
      .all({ $tenant_id: tenantId, $start: hourStart, $end: hourEnd }) as any[];

    const stmt = this.db.query<any, any>(
      `INSERT INTO metrics_hourly (tenant_id, device_id, check_id, ts_hour, name, avg_value, min_value, max_value, sample_count)
       VALUES ($tenant_id,$device_id,$check_id,$ts_hour,$name,$avg,$min,$max,$cnt)`
    );
    const tx = this.db.transaction((items: any[]) => {
      for (const r of items) {
        stmt.run({
          $tenant_id: tenantId,
          $device_id: r.device_id,
          $check_id: r.check_id,
          $ts_hour: hourStart,
          $name: r.name,
          $avg: r.avg_v,
          $min: r.min_v,
          $max: r.max_v,
          $cnt: r.cnt,
        });
      }
    });
    tx(rows);
    return rows.length;
  }

  async deleteRawOlderThan(cutoffIso: string): Promise<number> {
    const res = this.db.query<any, any>("DELETE FROM metrics WHERE ts < $cutoff").run({ $cutoff: cutoffIso });
    return res.changes;
  }

  async deleteRollupsOlderThan(cutoffIso: string): Promise<number> {
    const res = this.db.query<any, any>("DELETE FROM metrics_hourly WHERE ts_hour < $cutoff").run({ $cutoff: cutoffIso });
    return res.changes;
  }

  async percentile95(tenantId: string, q: MetricQuery): Promise<number | null> {
    const clauses = ["tenant_id=$tenant_id", "device_id=$device_id", "ts >= $from", "ts <= $to"];
    const params: Record<string, unknown> = { $tenant_id: tenantId, $device_id: q.deviceId, $from: q.from, $to: q.to };
    if (q.name) {
      clauses.push("name=$name");
      params.$name = q.name;
    }
    // bun:sqlite has no percentile aggregate — pull the (already indexed) values sorted and
    // interpolate in JS with the same algorithm Postgres's percentile_cont uses, so both adapters
    // agree given the same data.
    const rows = this.db
      .query<any, any>(`SELECT value FROM metrics WHERE ${clauses.join(" AND ")} ORDER BY value ASC`)
      .all(params) as Array<{ value: number }>;
    return percentile95(rows.map((r) => r.value));
  }
}

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

export class SqliteAlertRepo implements AlertRepo {
  constructor(private db: Database) {}

  async create(a: Alert): Promise<Alert> {
    this.db
      .query<any, any>(
        `INSERT INTO alerts (id, tenant_id, device_id, condition_key, severity, status, title, detail, opened_at, last_seen_at, acked_by, acked_at, resolved_at, escalation_step)
         VALUES ($id,$tenant_id,$device_id,$condition_key,$severity,$status,$title,$detail,$opened_at,$last_seen_at,$acked_by,$acked_at,$resolved_at,$escalation_step)`
      )
      .run({
        $id: a.id,
        $tenant_id: a.tenantId,
        $device_id: a.deviceId,
        $condition_key: a.conditionKey,
        $severity: a.severity,
        $status: a.status,
        $title: a.title,
        $detail: a.detail,
        $opened_at: a.openedAt,
        $last_seen_at: a.lastSeenAt,
        $acked_by: a.ackedBy,
        $acked_at: a.ackedAt,
        $resolved_at: a.resolvedAt,
        $escalation_step: a.escalationStep,
      });
    return a;
  }

  async update(tenantId: string, id: string, patch: Partial<Alert>): Promise<Alert | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    this.db
      .query<any, any>(
        `UPDATE alerts SET severity=$severity, status=$status, title=$title, detail=$detail, last_seen_at=$last_seen_at,
         acked_by=$acked_by, acked_at=$acked_at, resolved_at=$resolved_at, escalation_step=$escalation_step
         WHERE id=$id AND tenant_id=$tenant_id`
      )
      .run({
        $id: id,
        $tenant_id: tenantId,
        $severity: merged.severity,
        $status: merged.status,
        $title: merged.title,
        $detail: merged.detail,
        $last_seen_at: merged.lastSeenAt,
        $acked_by: merged.ackedBy,
        $acked_at: merged.ackedAt,
        $resolved_at: merged.resolvedAt,
        $escalation_step: merged.escalationStep,
      });
    return this.findById(tenantId, id);
  }

  async findById(tenantId: string, id: string): Promise<Alert | null> {
    const row = this.db.query<any, any>("SELECT * FROM alerts WHERE id=$id AND tenant_id=$tenant_id").get({ $id: id, $tenant_id: tenantId });
    return row ? rowToAlert(row) : null;
  }

  async findByIdAnyTenant(id: string): Promise<Alert | null> {
    const row = this.db.query<any, any>("SELECT * FROM alerts WHERE id=$id").get({ $id: id });
    return row ? rowToAlert(row) : null;
  }

  async findOpenByCondition(tenantId: string, deviceId: string, conditionKey: string): Promise<Alert | null> {
    const row = this.db
      .query<any, any>(
        `SELECT * FROM alerts WHERE tenant_id=$tenant_id AND device_id=$device_id AND condition_key=$condition_key AND status != 'resolved'`
      )
      .get({ $tenant_id: tenantId, $device_id: deviceId, $condition_key: conditionKey });
    return row ? rowToAlert(row) : null;
  }

  async list(tenantId: string, filter: AlertFilter = {}): Promise<Page<Alert>> {
    const clauses = ["tenant_id=$tenant_id"];
    const params: Record<string, unknown> = { $tenant_id: tenantId };
    if (filter.status) {
      clauses.push("status=$status");
      params.$status = filter.status;
    }
    if (filter.severity) {
      clauses.push("severity=$severity");
      params.$severity = filter.severity;
    }
    if (filter.deviceId) {
      clauses.push("device_id=$device_id");
      params.$device_id = filter.deviceId;
    }
    if (filter.from) {
      clauses.push("opened_at >= $from");
      params.$from = filter.from;
    }
    if (filter.to) {
      clauses.push("opened_at <= $to");
      params.$to = filter.to;
    }
    const where = clauses.join(" AND ");
    const total = (this.db.query<any, any>(`SELECT COUNT(*) as c FROM alerts WHERE ${where}`).get(params) as any).c as number;
    const limit = filter.limit ?? 200;
    const offset = filter.offset ?? 0;
    const rows = this.db
      .query<any, any>(`SELECT * FROM alerts WHERE ${where} ORDER BY opened_at DESC LIMIT ${limit} OFFSET ${offset}`)
      .all(params);
    return { items: rows.map(rowToAlert), total };
  }

  async listOpenUnacked(): Promise<Alert[]> {
    const rows = this.db.query<any, any>(`SELECT * FROM alerts WHERE status = 'open'`).all();
    return rows.map(rowToAlert);
  }

  async countOpenBySeverity(tenantId: string): Promise<Record<string, number>> {
    const rows = this.db
      .query<any, any>(`SELECT severity, COUNT(*) as c FROM alerts WHERE tenant_id=$tenant_id AND status='open' GROUP BY severity`)
      .all({ $tenant_id: tenantId }) as Array<{ severity: string; c: number }>;
    const out: Record<string, number> = { info: 0, warning: 0, critical: 0 };
    for (const r of rows) out[r.severity] = r.c;
    return out;
  }

  async countByDayAndSeverity(tenantId: string, fromIso: string, toIso: string): Promise<Array<{ day: string; severity: string; count: number }>> {
    const rows = this.db
      .query<any, any>(
        `SELECT substr(opened_at, 1, 10) as day, severity, COUNT(*) as c FROM alerts
         WHERE tenant_id=$tenant_id AND opened_at >= $from AND opened_at <= $to
         GROUP BY day, severity ORDER BY day`
      )
      .all({ $tenant_id: tenantId, $from: fromIso, $to: toIso }) as Array<{ day: string; severity: string; c: number }>;
    return rows.map((r) => ({ day: r.day, severity: r.severity, count: r.c }));
  }

  async claimEscalationStep(tenantId: string, id: string, expectedStep: number, newStep: number): Promise<boolean> {
    const res = this.db
      .query<any, any>("UPDATE alerts SET escalation_step=$new WHERE id=$id AND tenant_id=$tenant_id AND escalation_step=$expected")
      .run({ $id: id, $tenant_id: tenantId, $expected: expectedStep, $new: newStep });
    return res.changes > 0;
  }
}

export class SqliteNotificationLogRepo implements NotificationLogRepo {
  constructor(private db: Database) {}

  async record(e: NotificationLogEntry): Promise<void> {
    this.db
      .query<any, any>(
        `INSERT INTO notifications_log (tenant_id, alert_id, channel, target, status, error, created_at)
         VALUES ($tenant_id,$alert_id,$channel,$target,$status,$error,$created_at)`
      )
      .run({
        $tenant_id: e.tenantId,
        $alert_id: e.alertId,
        $channel: e.channel,
        $target: e.target,
        $status: e.status,
        $error: e.error,
        $created_at: e.createdAt,
      });
  }

  async list(tenantId: string, limit = 200): Promise<NotificationLogEntry[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM notifications_log WHERE tenant_id=$tenant_id ORDER BY created_at DESC LIMIT $limit")
      .all({ $tenant_id: tenantId, $limit: limit }) as any[];
    return rows.map((r) => ({
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

  async listByAlert(tenantId: string, alertId: string): Promise<NotificationLogEntry[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM notifications_log WHERE tenant_id=$tenant_id AND alert_id=$alert_id ORDER BY created_at ASC")
      .all({ $tenant_id: tenantId, $alert_id: alertId }) as any[];
    return rows.map((r) => ({
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

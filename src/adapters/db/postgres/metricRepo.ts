// Postgres-backed MetricRepo (M5) — mirrors the SQLite adapter's row shapes 1:1 so callers
// (application code, API routes) never need to know which backend is in play. `metrics` and
// `metrics_hourly` are already created by migrations-pg/0001_init.sql, same as every other
// Pg*Repo's tables — no schema self-creation here, that's the migration runner's job exclusively.
import type { Pool } from "pg";
import type { Metric } from "@domain/entities";
import type { MetricQuery, MetricRepo } from "@ports/repos";

function rowToMetric(r: any): Metric {
  return {
    id: r.id !== undefined ? Number(r.id) : undefined,
    tenantId: r.tenant_id,
    deviceId: r.device_id,
    checkId: r.check_id,
    ts: r.ts,
    name: r.name,
    value: Number(r.value),
  };
}

export class PgMetricRepo implements MetricRepo {
  constructor(private pool: Pool) {}

  async insertBatch(metrics: Metric[]): Promise<void> {
    if (metrics.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const m of metrics) {
        await client.query(
          `INSERT INTO metrics (tenant_id, device_id, check_id, ts, name, value) VALUES ($1,$2,$3,$4,$5,$6)`,
          [m.tenantId, m.deviceId, m.checkId, m.ts, m.name, m.value]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async queryRaw(tenantId: string, q: MetricQuery): Promise<Metric[]> {
    const { where, params } = buildWhere(tenantId, q);
    const res = await this.pool.query(`SELECT * FROM metrics WHERE ${where} ORDER BY ts ASC`, params);
    return res.rows.map(rowToMetric);
  }

  async queryHourly(tenantId: string, q: MetricQuery): Promise<Metric[]> {
    const { where, params } = buildWhere(tenantId, q, "ts_hour");
    const res = await this.pool.query(`SELECT * FROM metrics_hourly WHERE ${where} ORDER BY ts_hour ASC`, params);
    return res.rows.map((r: any) => ({
      id: r.id !== undefined ? Number(r.id) : undefined,
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      checkId: r.check_id,
      ts: r.ts_hour,
      name: r.name,
      value: Number(r.avg_value),
    }));
  }

  async rollupHour(tenantId: string, hourIso: string): Promise<number> {
    const hourEnd = new Date(new Date(hourIso).getTime() + 3600_000).toISOString();
    const agg = await this.pool.query(
      `SELECT device_id, check_id, name, AVG(value) as avg_v, MIN(value) as min_v, MAX(value) as max_v, COUNT(*) as cnt
       FROM metrics WHERE tenant_id=$1 AND ts >= $2 AND ts < $3
       GROUP BY device_id, check_id, name`,
      [tenantId, hourIso, hourEnd]
    );
    if (agg.rows.length === 0) return 0;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of agg.rows) {
        await client.query(
          `INSERT INTO metrics_hourly (tenant_id, device_id, check_id, ts_hour, name, avg_value, min_value, max_value, sample_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [tenantId, r.device_id, r.check_id, hourIso, r.name, r.avg_v, r.min_v, r.max_v, Number(r.cnt)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return agg.rows.length;
  }

  async deleteRawOlderThan(cutoffIso: string): Promise<number> {
    const res = await this.pool.query(`DELETE FROM metrics WHERE ts < $1`, [cutoffIso]);
    return res.rowCount ?? 0;
  }

  async deleteRollupsOlderThan(cutoffIso: string): Promise<number> {
    const res = await this.pool.query(`DELETE FROM metrics_hourly WHERE ts_hour < $1`, [cutoffIso]);
    return res.rowCount ?? 0;
  }

  async percentile95(tenantId: string, q: MetricQuery): Promise<number | null> {
    const { where, params } = buildWhere(tenantId, q);
    const res = await this.pool.query(
      `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95 FROM metrics WHERE ${where}`,
      params
    );
    const v = res.rows[0]?.p95;
    return v === null || v === undefined ? null : Number(v);
  }
}

function buildWhere(tenantId: string, q: MetricQuery, tsColumn: "ts" | "ts_hour" = "ts"): { where: string; params: unknown[] } {
  const params: unknown[] = [tenantId, q.deviceId, q.from, q.to];
  const clauses = [`tenant_id=$1`, `device_id=$2`, `${tsColumn} >= $3`, `${tsColumn} <= $4`];
  if (q.name) {
    params.push(q.name);
    clauses.push(`name=$${params.length}`);
  }
  return { where: clauses.join(" AND "), params };
}

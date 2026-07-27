import type { Pool, PoolClient } from "pg";
import type { Check, Device, DeviceGroup, DeviceStatus } from "@domain/entities";
import type { CheckRepo, DeviceFilter, DeviceRepo, DeviceWithChecks, DeviceWithStatus, GroupRepo, Page, StatusRepo } from "@ports/repos";

function rowToDevice(r: any): Device {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    ip: r.ip,
    mac: r.mac,
    vendor: r.vendor,
    type: r.type,
    location: r.location,
    groupId: r.group_id,
    responsibleUserId: r.responsible_user_id,
    intervalSec: r.interval_sec,
    enabled: r.enabled,
    snmpCredsEnc: r.snmp_creds_enc,
    tags: r.tags ?? [],
    uplinkDeviceId: r.uplink_device_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Full parity with SqliteDeviceRepo (src/adapters/db/sqlite/deviceRepos.ts) — every DeviceRepo
 * method is implemented (the port interface requires it), though M0's own verification test only
 * exercises create/findByIp/list/createBatchWithChecks (the device-limit-enforcement path). The
 * rest (listWithStatus, findByUplink, listAllEnabled) are needed starting M1/M3 and are written
 * now, not stubbed, since the join/query logic is small and there's no benefit to a second pass. */
export class PgDeviceRepo implements DeviceRepo {
  constructor(private db: Pool) {}

  async create(d: Device): Promise<Device> {
    await this.db.query(
      `INSERT INTO devices (id, tenant_id, name, ip, mac, vendor, type, location, group_id, responsible_user_id, interval_sec, enabled, snmp_creds_enc, tags, uplink_device_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        d.id,
        d.tenantId,
        d.name,
        d.ip,
        d.mac,
        d.vendor,
        d.type,
        d.location,
        d.groupId,
        d.responsibleUserId,
        d.intervalSec,
        d.enabled,
        d.snmpCredsEnc,
        JSON.stringify(d.tags ?? []),
        d.uplinkDeviceId,
        d.createdAt,
        d.updatedAt,
      ]
    );
    return d;
  }

  async update(tenantId: string, id: string, patch: Partial<Device>): Promise<Device | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged: Device = { ...existing, ...patch, id, tenantId };
    await this.db.query(
      `UPDATE devices SET name=$1, ip=$2, mac=$3, vendor=$4, type=$5, location=$6, group_id=$7, responsible_user_id=$8,
       interval_sec=$9, enabled=$10, snmp_creds_enc=$11, tags=$12, uplink_device_id=$13, updated_at=$14
       WHERE id=$15 AND tenant_id=$16`,
      [
        merged.name,
        merged.ip,
        merged.mac,
        merged.vendor,
        merged.type,
        merged.location,
        merged.groupId,
        merged.responsibleUserId,
        merged.intervalSec,
        merged.enabled,
        merged.snmpCredsEnc,
        JSON.stringify(merged.tags ?? []),
        merged.uplinkDeviceId,
        new Date().toISOString(),
        id,
        tenantId,
      ]
    );
    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("DELETE FROM devices WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return (res.rowCount ?? 0) > 0;
  }

  async findById(tenantId: string, id: string): Promise<Device | null> {
    const { rows } = await this.db.query("SELECT * FROM devices WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return rows[0] ? rowToDevice(rows[0]) : null;
  }

  async findByIp(tenantId: string, ip: string): Promise<Device | null> {
    const { rows } = await this.db.query("SELECT * FROM devices WHERE ip=$1 AND tenant_id=$2", [ip, tenantId]);
    return rows[0] ? rowToDevice(rows[0]) : null;
  }

  async findByUplink(tenantId: string, uplinkDeviceId: string): Promise<Device[]> {
    const { rows } = await this.db.query("SELECT * FROM devices WHERE tenant_id=$1 AND uplink_device_id=$2", [tenantId, uplinkDeviceId]);
    return rows.map(rowToDevice);
  }

  private buildFilter(filter: DeviceFilter, startIndex: number): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let i = startIndex;
    if (filter.groupId) {
      params.push(filter.groupId);
      clauses.push(`group_id=$${i++}`);
    }
    if (filter.type) {
      params.push(filter.type);
      clauses.push(`type=$${i++}`);
    }
    if (filter.enabled !== undefined) {
      params.push(filter.enabled);
      clauses.push(`enabled=$${i++}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      clauses.push(`(name ILIKE $${i} OR ip ILIKE $${i})`);
      i++;
    }
    return { where: clauses.join(" AND "), params };
  }

  async list(tenantId: string, filter: DeviceFilter = {}): Promise<Page<Device>> {
    const { where: extra, params: extraParams } = this.buildFilter(filter, 2);
    const where = ["tenant_id = $1", ...(extra ? [extra] : [])].join(" AND ");
    const params = [tenantId, ...extraParams];
    const totalRes = await this.db.query(`SELECT COUNT(*)::int as c FROM devices WHERE ${where}`, params);
    const limit = filter.limit ?? 500;
    const offset = filter.offset ?? 0;
    const rowsRes = await this.db.query(
      `SELECT * FROM devices WHERE ${where} ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { items: rowsRes.rows.map(rowToDevice), total: totalRes.rows[0].c };
  }

  async listWithStatus(tenantId: string, filter: DeviceFilter = {}): Promise<Page<DeviceWithStatus>> {
    const { where: extraRaw, params: extraParams } = this.buildFilter(filter, 2);
    const extra = extraRaw ? extraRaw.replace(/\b(group_id|type|enabled|name|ip)\b/g, "d.$1") : "";
    const where = ["d.tenant_id = $1", ...(extra ? [extra] : [])].join(" AND ");
    const params = [tenantId, ...extraParams];
    const totalRes = await this.db.query(`SELECT COUNT(*)::int as c FROM devices d WHERE ${where}`, params);
    const limit = filter.limit ?? 1000;
    const offset = filter.offset ?? 0;
    const rowsRes = await this.db.query(
      `SELECT d.*, s.state as status_state, s.since as status_since, s.last_latency_ms as status_last_latency_ms
       FROM devices d LEFT JOIN device_status s ON s.device_id = d.id
       WHERE ${where} ORDER BY d.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return {
      items: rowsRes.rows.map((r: any) => ({
        ...rowToDevice(r),
        state: r.status_state ?? null,
        since: r.status_since ?? null,
        lastLatencyMs: r.status_last_latency_ms ?? null,
      })),
      total: totalRes.rows[0].c,
    };
  }

  async listAllEnabled(): Promise<Device[]> {
    const { rows } = await this.db.query("SELECT * FROM devices WHERE enabled = TRUE");
    return rows.map(rowToDevice);
  }

  async createBatchWithChecks(items: DeviceWithChecks[]): Promise<Device[]> {
    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const { device, checks } of items) {
        await client.query(
          `INSERT INTO devices (id, tenant_id, name, ip, mac, vendor, type, location, group_id, responsible_user_id, interval_sec, enabled, snmp_creds_enc, tags, uplink_device_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            device.id,
            device.tenantId,
            device.name,
            device.ip,
            device.mac,
            device.vendor,
            device.type,
            device.location,
            device.groupId,
            device.responsibleUserId,
            device.intervalSec,
            device.enabled,
            device.snmpCredsEnc,
            JSON.stringify(device.tags ?? []),
            device.uplinkDeviceId,
            device.createdAt,
            device.updatedAt,
          ]
        );
        for (const check of checks) {
          await client.query(
            `INSERT INTO checks (id, tenant_id, device_id, kind, config, thresholds, enabled, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [check.id, check.tenantId, check.deviceId, check.kind, JSON.stringify(check.config), JSON.stringify(check.thresholds), check.enabled, check.createdAt]
          );
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return items.map((i) => i.device);
  }
}

function rowToGroup(r: any): DeviceGroup {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    escalationChain: r.escalation_chain ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class PgGroupRepo implements GroupRepo {
  constructor(private db: Pool) {}

  async create(g: DeviceGroup): Promise<DeviceGroup> {
    await this.db.query(
      `INSERT INTO device_groups (id, tenant_id, name, escalation_chain, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [g.id, g.tenantId, g.name, JSON.stringify(g.escalationChain), g.createdAt, g.updatedAt]
    );
    return g;
  }

  async update(tenantId: string, id: string, patch: Partial<DeviceGroup>): Promise<DeviceGroup | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.db.query(`UPDATE device_groups SET name=$1, escalation_chain=$2, updated_at=$3 WHERE id=$4 AND tenant_id=$5`, [
      merged.name,
      JSON.stringify(merged.escalationChain),
      new Date().toISOString(),
      id,
      tenantId,
    ]);
    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("DELETE FROM device_groups WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return (res.rowCount ?? 0) > 0;
  }

  async findById(tenantId: string, id: string): Promise<DeviceGroup | null> {
    const { rows } = await this.db.query("SELECT * FROM device_groups WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return rows[0] ? rowToGroup(rows[0]) : null;
  }

  async list(tenantId: string): Promise<DeviceGroup[]> {
    const { rows } = await this.db.query("SELECT * FROM device_groups WHERE tenant_id=$1 ORDER BY name", [tenantId]);
    return rows.map(rowToGroup);
  }
}

function rowToCheck(r: any): Check {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    deviceId: r.device_id,
    kind: r.kind,
    config: r.config ?? {},
    thresholds: r.thresholds ?? {},
    enabled: r.enabled,
    createdAt: r.created_at,
  };
}

export class PgCheckRepo implements CheckRepo {
  constructor(private db: Pool) {}

  async create(c: Check): Promise<Check> {
    await this.db.query(
      `INSERT INTO checks (id, tenant_id, device_id, kind, config, thresholds, enabled, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.id, c.tenantId, c.deviceId, c.kind, JSON.stringify(c.config), JSON.stringify(c.thresholds), c.enabled, c.createdAt]
    );
    return c;
  }

  async update(tenantId: string, id: string, patch: Partial<Check>): Promise<Check | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.db.query(`UPDATE checks SET kind=$1, config=$2, thresholds=$3, enabled=$4 WHERE id=$5 AND tenant_id=$6`, [
      merged.kind,
      JSON.stringify(merged.config),
      JSON.stringify(merged.thresholds),
      merged.enabled,
      id,
      tenantId,
    ]);
    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("DELETE FROM checks WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return (res.rowCount ?? 0) > 0;
  }

  async findById(tenantId: string, id: string): Promise<Check | null> {
    const { rows } = await this.db.query("SELECT * FROM checks WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return rows[0] ? rowToCheck(rows[0]) : null;
  }

  async listByDevice(tenantId: string, deviceId: string): Promise<Check[]> {
    const { rows } = await this.db.query("SELECT * FROM checks WHERE tenant_id=$1 AND device_id=$2", [tenantId, deviceId]);
    return rows.map(rowToCheck);
  }

  async listAllEnabled(): Promise<Check[]> {
    const { rows } = await this.db.query("SELECT * FROM checks WHERE enabled = TRUE");
    return rows.map(rowToCheck);
  }
}

function rowToStatus(r: any): DeviceStatus {
  return {
    deviceId: r.device_id,
    tenantId: r.tenant_id,
    state: r.state,
    since: r.since,
    lastSeen: r.last_seen,
    lastLatencyMs: r.last_latency_ms,
    consecutiveFails: r.consecutive_fails,
    consecutiveOk: r.consecutive_ok,
    transitionLog: r.transition_log ?? [],
  };
}

export class PgStatusRepo implements StatusRepo {
  constructor(private db: Pool) {}

  async upsert(s: DeviceStatus): Promise<void> {
    await this.db.query(
      `INSERT INTO device_status (device_id, tenant_id, state, since, last_seen, last_latency_ms, consecutive_fails, consecutive_ok, transition_log)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (device_id) DO UPDATE SET
         state=excluded.state, since=excluded.since, last_seen=excluded.last_seen,
         last_latency_ms=excluded.last_latency_ms, consecutive_fails=excluded.consecutive_fails,
         consecutive_ok=excluded.consecutive_ok, transition_log=excluded.transition_log`,
      [s.deviceId, s.tenantId, s.state, s.since, s.lastSeen, s.lastLatencyMs, s.consecutiveFails, s.consecutiveOk, JSON.stringify(s.transitionLog)]
    );
  }

  async findByDeviceId(tenantId: string, deviceId: string): Promise<DeviceStatus | null> {
    const { rows } = await this.db.query("SELECT * FROM device_status WHERE device_id=$1 AND tenant_id=$2", [deviceId, tenantId]);
    return rows[0] ? rowToStatus(rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<DeviceStatus[]> {
    const { rows } = await this.db.query("SELECT * FROM device_status WHERE tenant_id=$1", [tenantId]);
    return rows.map(rowToStatus);
  }

  async summary(tenantId: string): Promise<Record<string, number>> {
    const { rows } = await this.db.query("SELECT state, COUNT(*)::int as c FROM device_status WHERE tenant_id=$1 GROUP BY state", [tenantId]);
    const out: Record<string, number> = { up: 0, degraded: 0, down: 0, flapping: 0, maintenance: 0 };
    for (const r of rows as Array<{ state: string; c: number }>) out[r.state] = r.c;
    return out;
  }
}

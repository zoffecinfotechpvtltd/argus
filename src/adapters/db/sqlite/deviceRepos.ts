import type { Database } from "bun:sqlite";
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
    enabled: !!r.enabled,
    snmpCredsEnc: r.snmp_creds_enc,
    tags: JSON.parse(r.tags ?? "[]"),
    uplinkDeviceId: r.uplink_device_id,
    criticalAsset: !!r.critical_asset,
    model: r.model,
    firmwareVersion: r.firmware_version,
    serialNumber: r.serial_number,
    haRole: r.ha_role,
    apiVendor: r.api_vendor,
    apiCredsEnc: r.api_creds_enc,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class SqliteDeviceRepo implements DeviceRepo {
  constructor(private db: Database) {}

  async create(d: Device): Promise<Device> {
    this.db
      .query<any, any>(
        `INSERT INTO devices (id, tenant_id, name, ip, mac, vendor, type, location, group_id, responsible_user_id, interval_sec, enabled, snmp_creds_enc, tags, uplink_device_id, critical_asset, model, firmware_version, serial_number, ha_role, api_vendor, api_creds_enc, created_at, updated_at)
         VALUES ($id,$tenant_id,$name,$ip,$mac,$vendor,$type,$location,$group_id,$responsible_user_id,$interval_sec,$enabled,$snmp_creds_enc,$tags,$uplink_device_id,$critical_asset,$model,$firmware_version,$serial_number,$ha_role,$api_vendor,$api_creds_enc,$created_at,$updated_at)`
      )
      .run({
        $id: d.id,
        $tenant_id: d.tenantId,
        $name: d.name,
        $ip: d.ip,
        $mac: d.mac,
        $vendor: d.vendor,
        $type: d.type,
        $location: d.location,
        $group_id: d.groupId,
        $responsible_user_id: d.responsibleUserId,
        $interval_sec: d.intervalSec,
        $enabled: d.enabled ? 1 : 0,
        $snmp_creds_enc: d.snmpCredsEnc,
        $tags: JSON.stringify(d.tags ?? []),
        $uplink_device_id: d.uplinkDeviceId ?? null,
        $critical_asset: d.criticalAsset ? 1 : 0,
        $model: d.model,
        $firmware_version: d.firmwareVersion,
        $serial_number: d.serialNumber,
        $ha_role: d.haRole,
        $api_vendor: d.apiVendor,
        $api_creds_enc: d.apiCredsEnc,
        $created_at: d.createdAt,
        $updated_at: d.updatedAt,
      });
    return d;
  }

  async update(tenantId: string, id: string, patch: Partial<Device>): Promise<Device | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged: Device = { ...existing, ...patch, id, tenantId };
    this.db
      .query<any, any>(
        `UPDATE devices SET name=$name, ip=$ip, mac=$mac, vendor=$vendor, type=$type, location=$location,
         group_id=$group_id, responsible_user_id=$responsible_user_id, interval_sec=$interval_sec, enabled=$enabled,
         snmp_creds_enc=$snmp_creds_enc, tags=$tags, uplink_device_id=$uplink_device_id, critical_asset=$critical_asset,
         model=$model, firmware_version=$firmware_version, serial_number=$serial_number, ha_role=$ha_role,
         api_vendor=$api_vendor, api_creds_enc=$api_creds_enc, updated_at=$updated_at
         WHERE id=$id AND tenant_id=$tenant_id`
      )
      .run({
        $id: id,
        $tenant_id: tenantId,
        $name: merged.name,
        $ip: merged.ip,
        $mac: merged.mac,
        $vendor: merged.vendor,
        $type: merged.type,
        $location: merged.location,
        $group_id: merged.groupId,
        $responsible_user_id: merged.responsibleUserId,
        $interval_sec: merged.intervalSec,
        $enabled: merged.enabled ? 1 : 0,
        $snmp_creds_enc: merged.snmpCredsEnc,
        $tags: JSON.stringify(merged.tags ?? []),
        $uplink_device_id: merged.uplinkDeviceId ?? null,
        $critical_asset: merged.criticalAsset ? 1 : 0,
        $model: merged.model,
        $firmware_version: merged.firmwareVersion,
        $serial_number: merged.serialNumber,
        $ha_role: merged.haRole,
        $api_vendor: merged.apiVendor,
        $api_creds_enc: merged.apiCredsEnc,
        $updated_at: new Date().toISOString(),
      });
    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = this.db.query<any, any>("DELETE FROM devices WHERE id=$id AND tenant_id=$tenant_id").run({ $id: id, $tenant_id: tenantId });
    return res.changes > 0;
  }

  async findById(tenantId: string, id: string): Promise<Device | null> {
    const row = this.db.query<any, any>("SELECT * FROM devices WHERE id=$id AND tenant_id=$tenant_id").get({ $id: id, $tenant_id: tenantId });
    return row ? rowToDevice(row) : null;
  }

  async findByIp(tenantId: string, ip: string): Promise<Device | null> {
    const row = this.db.query<any, any>("SELECT * FROM devices WHERE ip=$ip AND tenant_id=$tenant_id").get({ $ip: ip, $tenant_id: tenantId });
    return row ? rowToDevice(row) : null;
  }

  async findByUplink(tenantId: string, uplinkDeviceId: string): Promise<Device[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM devices WHERE tenant_id=$tenant_id AND uplink_device_id=$uplink_device_id")
      .all({ $tenant_id: tenantId, $uplink_device_id: uplinkDeviceId }) as any[];
    return rows.map(rowToDevice);
  }

  async list(tenantId: string, filter: DeviceFilter = {}): Promise<Page<Device>> {
    const clauses = ["tenant_id = $tenant_id"];
    const params: Record<string, unknown> = { $tenant_id: tenantId };
    if (filter.groupId) {
      clauses.push("group_id = $group_id");
      params.$group_id = filter.groupId;
    }
    if (filter.type) {
      clauses.push("type = $type");
      params.$type = filter.type;
    }
    if (filter.enabled !== undefined) {
      clauses.push("enabled = $enabled");
      params.$enabled = filter.enabled ? 1 : 0;
    }
    if (filter.search) {
      clauses.push("(name LIKE $search OR ip LIKE $search)");
      params.$search = `%${filter.search}%`;
    }
    const where = clauses.join(" AND ");
    const total = (this.db.query<any, any>(`SELECT COUNT(*) as c FROM devices WHERE ${where}`).get(params) as any).c as number;
    const limit = filter.limit ?? 500;
    const offset = filter.offset ?? 0;
    const rows = this.db
      .query<any, any>(`SELECT * FROM devices WHERE ${where} ORDER BY name LIMIT ${limit} OFFSET ${offset}`)
      .all(params);
    return { items: rows.map(rowToDevice), total };
  }

  async listWithStatus(tenantId: string, filter: DeviceFilter = {}): Promise<Page<DeviceWithStatus>> {
    const clauses = ["d.tenant_id = $tenant_id"];
    const params: Record<string, unknown> = { $tenant_id: tenantId };
    if (filter.groupId) {
      clauses.push("d.group_id = $group_id");
      params.$group_id = filter.groupId;
    }
    if (filter.type) {
      clauses.push("d.type = $type");
      params.$type = filter.type;
    }
    if (filter.enabled !== undefined) {
      clauses.push("d.enabled = $enabled");
      params.$enabled = filter.enabled ? 1 : 0;
    }
    if (filter.search) {
      clauses.push("(d.name LIKE $search OR d.ip LIKE $search)");
      params.$search = `%${filter.search}%`;
    }
    const where = clauses.join(" AND ");
    const total = (this.db.query<any, any>(`SELECT COUNT(*) as c FROM devices d WHERE ${where}`).get(params) as any).c as number;
    const limit = filter.limit ?? 1000;
    const offset = filter.offset ?? 0;
    const rows = this.db
      .query<any, any>(
        `SELECT d.*, s.state as status_state, s.since as status_since, s.last_latency_ms as status_last_latency_ms
         FROM devices d LEFT JOIN device_status s ON s.device_id = d.id
         WHERE ${where} ORDER BY d.name LIMIT ${limit} OFFSET ${offset}`
      )
      .all(params);
    return {
      items: rows.map((r: any) => ({
        ...rowToDevice(r),
        state: r.status_state ?? null,
        since: r.status_since ?? null,
        lastLatencyMs: r.status_last_latency_ms ?? null,
      })),
      total,
    };
  }

  async listAllEnabled(): Promise<Device[]> {
    const rows = this.db.query<any, any>("SELECT * FROM devices WHERE enabled = 1").all();
    return rows.map(rowToDevice);
  }

  async createBatchWithChecks(items: DeviceWithChecks[]): Promise<Device[]> {
    const insertDevice = this.db.query<any, any>(
      `INSERT INTO devices (id, tenant_id, name, ip, mac, vendor, type, location, group_id, responsible_user_id, interval_sec, enabled, snmp_creds_enc, tags, uplink_device_id, critical_asset, model, firmware_version, serial_number, ha_role, api_vendor, api_creds_enc, created_at, updated_at)
       VALUES ($id,$tenant_id,$name,$ip,$mac,$vendor,$type,$location,$group_id,$responsible_user_id,$interval_sec,$enabled,$snmp_creds_enc,$tags,$uplink_device_id,$critical_asset,$model,$firmware_version,$serial_number,$ha_role,$api_vendor,$api_creds_enc,$created_at,$updated_at)`
    );
    const insertCheck = this.db.query<any, any>(
      `INSERT INTO checks (id, tenant_id, device_id, kind, config, thresholds, enabled, created_at)
       VALUES ($id,$tenant_id,$device_id,$kind,$config,$thresholds,$enabled,$created_at)`
    );

    const tx = this.db.transaction((rows: DeviceWithChecks[]) => {
      for (const { device, checks } of rows) {
        insertDevice.run({
          $id: device.id,
          $tenant_id: device.tenantId,
          $name: device.name,
          $ip: device.ip,
          $mac: device.mac,
          $vendor: device.vendor,
          $type: device.type,
          $location: device.location,
          $group_id: device.groupId,
          $responsible_user_id: device.responsibleUserId,
          $interval_sec: device.intervalSec,
          $enabled: device.enabled ? 1 : 0,
          $snmp_creds_enc: device.snmpCredsEnc,
          $tags: JSON.stringify(device.tags ?? []),
          $uplink_device_id: device.uplinkDeviceId ?? null,
          $critical_asset: device.criticalAsset ? 1 : 0,
          $model: device.model,
          $firmware_version: device.firmwareVersion,
          $serial_number: device.serialNumber,
          $ha_role: device.haRole,
          $api_vendor: device.apiVendor,
          $api_creds_enc: device.apiCredsEnc,
          $created_at: device.createdAt,
          $updated_at: device.updatedAt,
        });
        for (const check of checks) {
          insertCheck.run({
            $id: check.id,
            $tenant_id: check.tenantId,
            $device_id: check.deviceId,
            $kind: check.kind,
            $config: JSON.stringify(check.config),
            $thresholds: JSON.stringify(check.thresholds),
            $enabled: check.enabled ? 1 : 0,
            $created_at: check.createdAt,
          });
        }
      }
    });
    tx(items);

    return items.map((i) => i.device);
  }
}

function rowToGroup(r: any): DeviceGroup {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    escalationChain: JSON.parse(r.escalation_chain ?? "[]"),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class SqliteGroupRepo implements GroupRepo {
  constructor(private db: Database) {}

  async create(g: DeviceGroup): Promise<DeviceGroup> {
    this.db
      .query<any, any>(
        `INSERT INTO device_groups (id, tenant_id, name, escalation_chain, created_at, updated_at)
         VALUES ($id,$tenant_id,$name,$chain,$created_at,$updated_at)`
      )
      .run({
        $id: g.id,
        $tenant_id: g.tenantId,
        $name: g.name,
        $chain: JSON.stringify(g.escalationChain),
        $created_at: g.createdAt,
        $updated_at: g.updatedAt,
      });
    return g;
  }

  async update(tenantId: string, id: string, patch: Partial<DeviceGroup>): Promise<DeviceGroup | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    this.db
      .query<any, any>("UPDATE device_groups SET name=$name, escalation_chain=$chain, updated_at=$updated_at WHERE id=$id AND tenant_id=$tenant_id")
      .run({
        $id: id,
        $tenant_id: tenantId,
        $name: merged.name,
        $chain: JSON.stringify(merged.escalationChain),
        $updated_at: new Date().toISOString(),
      });
    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = this.db.query<any, any>("DELETE FROM device_groups WHERE id=$id AND tenant_id=$tenant_id").run({ $id: id, $tenant_id: tenantId });
    return res.changes > 0;
  }

  async findById(tenantId: string, id: string): Promise<DeviceGroup | null> {
    const row = this.db.query<any, any>("SELECT * FROM device_groups WHERE id=$id AND tenant_id=$tenant_id").get({ $id: id, $tenant_id: tenantId });
    return row ? rowToGroup(row) : null;
  }

  async list(tenantId: string): Promise<DeviceGroup[]> {
    const rows = this.db.query<any, any>("SELECT * FROM device_groups WHERE tenant_id=$tenant_id ORDER BY name").all({ $tenant_id: tenantId });
    return rows.map(rowToGroup);
  }
}

function rowToCheck(r: any): Check {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    deviceId: r.device_id,
    kind: r.kind,
    config: JSON.parse(r.config ?? "{}"),
    thresholds: JSON.parse(r.thresholds ?? "{}"),
    enabled: !!r.enabled,
    createdAt: r.created_at,
  };
}

export class SqliteCheckRepo implements CheckRepo {
  constructor(private db: Database) {}

  async create(c: Check): Promise<Check> {
    this.db
      .query<any, any>(
        `INSERT INTO checks (id, tenant_id, device_id, kind, config, thresholds, enabled, created_at)
         VALUES ($id,$tenant_id,$device_id,$kind,$config,$thresholds,$enabled,$created_at)`
      )
      .run({
        $id: c.id,
        $tenant_id: c.tenantId,
        $device_id: c.deviceId,
        $kind: c.kind,
        $config: JSON.stringify(c.config),
        $thresholds: JSON.stringify(c.thresholds),
        $enabled: c.enabled ? 1 : 0,
        $created_at: c.createdAt,
      });
    return c;
  }

  async update(tenantId: string, id: string, patch: Partial<Check>): Promise<Check | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    this.db
      .query<any, any>(
        `UPDATE checks SET kind=$kind, config=$config, thresholds=$thresholds, enabled=$enabled WHERE id=$id AND tenant_id=$tenant_id`
      )
      .run({
        $id: id,
        $tenant_id: tenantId,
        $kind: merged.kind,
        $config: JSON.stringify(merged.config),
        $thresholds: JSON.stringify(merged.thresholds),
        $enabled: merged.enabled ? 1 : 0,
      });
    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = this.db.query<any, any>("DELETE FROM checks WHERE id=$id AND tenant_id=$tenant_id").run({ $id: id, $tenant_id: tenantId });
    return res.changes > 0;
  }

  async findById(tenantId: string, id: string): Promise<Check | null> {
    const row = this.db.query<any, any>("SELECT * FROM checks WHERE id=$id AND tenant_id=$tenant_id").get({ $id: id, $tenant_id: tenantId });
    return row ? rowToCheck(row) : null;
  }

  async listByDevice(tenantId: string, deviceId: string): Promise<Check[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM checks WHERE tenant_id=$tenant_id AND device_id=$device_id")
      .all({ $tenant_id: tenantId, $device_id: deviceId });
    return rows.map(rowToCheck);
  }

  async listAllEnabled(): Promise<Check[]> {
    const rows = this.db.query<any, any>("SELECT * FROM checks WHERE enabled = 1").all();
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
    transitionLog: JSON.parse(r.transition_log ?? "[]"),
  };
}

export class SqliteStatusRepo implements StatusRepo {
  constructor(private db: Database) {}

  async upsert(s: DeviceStatus): Promise<void> {
    this.db
      .query<any, any>(
        `INSERT INTO device_status (device_id, tenant_id, state, since, last_seen, last_latency_ms, consecutive_fails, consecutive_ok, transition_log)
         VALUES ($device_id,$tenant_id,$state,$since,$last_seen,$last_latency_ms,$consecutive_fails,$consecutive_ok,$transition_log)
         ON CONFLICT(device_id) DO UPDATE SET
           state=excluded.state, since=excluded.since, last_seen=excluded.last_seen,
           last_latency_ms=excluded.last_latency_ms, consecutive_fails=excluded.consecutive_fails,
           consecutive_ok=excluded.consecutive_ok, transition_log=excluded.transition_log`
      )
      .run({
        $device_id: s.deviceId,
        $tenant_id: s.tenantId,
        $state: s.state,
        $since: s.since,
        $last_seen: s.lastSeen,
        $last_latency_ms: s.lastLatencyMs,
        $consecutive_fails: s.consecutiveFails,
        $consecutive_ok: s.consecutiveOk,
        $transition_log: JSON.stringify(s.transitionLog),
      });
  }

  async findByDeviceId(tenantId: string, deviceId: string): Promise<DeviceStatus | null> {
    const row = this.db
      .query<any, any>("SELECT * FROM device_status WHERE device_id=$device_id AND tenant_id=$tenant_id")
      .get({ $device_id: deviceId, $tenant_id: tenantId });
    return row ? rowToStatus(row) : null;
  }

  async listByTenant(tenantId: string): Promise<DeviceStatus[]> {
    const rows = this.db.query<any, any>("SELECT * FROM device_status WHERE tenant_id=$tenant_id").all({ $tenant_id: tenantId });
    return rows.map(rowToStatus);
  }

  async summary(tenantId: string): Promise<Record<string, number>> {
    const rows = this.db
      .query<any, any>("SELECT state, COUNT(*) as c FROM device_status WHERE tenant_id=$tenant_id GROUP BY state")
      .all({ $tenant_id: tenantId }) as Array<{ state: string; c: number }>;
    const out: Record<string, number> = { up: 0, degraded: 0, down: 0, flapping: 0, maintenance: 0 };
    for (const r of rows) out[r.state] = r.c;
    return out;
  }
}

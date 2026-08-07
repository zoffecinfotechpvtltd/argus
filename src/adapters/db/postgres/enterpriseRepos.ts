import type { Pool } from "pg";
import type { ApiKey, DiscoverySchedule, RemoteAgent } from "@domain/entities";
import type { ApiKeyRepo, DiscoveryScheduleRepo, RemoteAgentRepo } from "@ports/repos";

function rowToApiKey(r: any): ApiKey {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    keyHash: r.key_hash,
    keyPrefix: r.key_prefix,
    scopes: r.scopes ?? ["read"],
    createdBy: r.created_by,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  };
}

export class PgApiKeyRepo implements ApiKeyRepo {
  constructor(private db: Pool) {}

  async create(k: ApiKey): Promise<ApiKey> {
    await this.db.query(
      `INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, created_by, created_at, revoked_at, last_used_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [k.id, k.tenantId, k.name, k.keyHash, k.keyPrefix, JSON.stringify(k.scopes), k.createdBy, k.createdAt, k.revokedAt, k.lastUsedAt]
    );
    return k;
  }

  async revoke(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("UPDATE api_keys SET revoked_at=$1 WHERE id=$2 AND tenant_id=$3 AND revoked_at IS NULL", [
      new Date().toISOString(),
      id,
      tenantId,
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  async list(tenantId: string): Promise<ApiKey[]> {
    const { rows } = await this.db.query("SELECT * FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC", [tenantId]);
    return rows.map(rowToApiKey);
  }

  async findByPrefix(prefix: string): Promise<ApiKey | null> {
    const { rows } = await this.db.query("SELECT * FROM api_keys WHERE key_prefix=$1", [prefix]);
    return rows[0] ? rowToApiKey(rows[0]) : null;
  }

  async touchLastUsed(id: string, atIso: string): Promise<void> {
    await this.db.query("UPDATE api_keys SET last_used_at=$1 WHERE id=$2", [atIso, id]);
  }
}

function rowToRemoteAgent(r: any): RemoteAgent {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    tokenHash: r.token_hash,
    tokenPrefix: r.token_prefix,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    revokedAt: r.revoked_at,
  };
}

export class PgRemoteAgentRepo implements RemoteAgentRepo {
  constructor(private db: Pool) {}

  async create(a: RemoteAgent): Promise<RemoteAgent> {
    await this.db.query(
      `INSERT INTO remote_agents (id, tenant_id, name, token_hash, token_prefix, created_at, last_seen_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.id, a.tenantId, a.name, a.tokenHash, a.tokenPrefix, a.createdAt, a.lastSeenAt, a.revokedAt]
    );
    return a;
  }

  async revoke(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("UPDATE remote_agents SET revoked_at=$1 WHERE id=$2 AND tenant_id=$3 AND revoked_at IS NULL", [
      new Date().toISOString(),
      id,
      tenantId,
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  async list(tenantId: string): Promise<RemoteAgent[]> {
    const { rows } = await this.db.query("SELECT * FROM remote_agents WHERE tenant_id=$1 ORDER BY created_at DESC", [tenantId]);
    return rows.map(rowToRemoteAgent);
  }

  async findById(tenantId: string, id: string): Promise<RemoteAgent | null> {
    const { rows } = await this.db.query("SELECT * FROM remote_agents WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return rows[0] ? rowToRemoteAgent(rows[0]) : null;
  }

  async findByPrefix(prefix: string): Promise<RemoteAgent | null> {
    const { rows } = await this.db.query("SELECT * FROM remote_agents WHERE token_prefix=$1", [prefix]);
    return rows[0] ? rowToRemoteAgent(rows[0]) : null;
  }

  async touchLastSeen(id: string, atIso: string): Promise<void> {
    await this.db.query("UPDATE remote_agents SET last_seen_at=$1 WHERE id=$2", [atIso, id]);
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
    enabled: r.enabled,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export class PgDiscoveryScheduleRepo implements DiscoveryScheduleRepo {
  constructor(private db: Pool) {}

  async create(s: DiscoverySchedule): Promise<DiscoverySchedule> {
    await this.db.query(
      `INSERT INTO discovery_schedules (id, tenant_id, cidr, snmp_community_enc, recurrence, target_group_id, enabled, last_run_at, next_run_at, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [s.id, s.tenantId, s.cidr, s.snmpCredsEnc, s.recurrence, s.targetGroupId, s.enabled, s.lastRunAt, s.nextRunAt, s.createdBy, s.createdAt]
    );
    return s;
  }

  async update(tenantId: string, id: string, patch: Partial<DiscoverySchedule>): Promise<DiscoverySchedule | null> {
    const { rows } = await this.db.query("SELECT * FROM discovery_schedules WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    if (!rows[0]) return null;
    const merged = { ...rowToDiscoverySchedule(rows[0]), ...patch };
    await this.db.query(
      `UPDATE discovery_schedules SET cidr=$1, snmp_community_enc=$2, recurrence=$3, target_group_id=$4, enabled=$5,
       last_run_at=$6, next_run_at=$7 WHERE id=$8 AND tenant_id=$9`,
      [merged.cidr, merged.snmpCredsEnc, merged.recurrence, merged.targetGroupId, merged.enabled, merged.lastRunAt, merged.nextRunAt, id, tenantId]
    );
    const { rows: after } = await this.db.query("SELECT * FROM discovery_schedules WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return after[0] ? rowToDiscoverySchedule(after[0]) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query("DELETE FROM discovery_schedules WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return (res.rowCount ?? 0) > 0;
  }

  async list(tenantId: string): Promise<DiscoverySchedule[]> {
    const { rows } = await this.db.query("SELECT * FROM discovery_schedules WHERE tenant_id=$1 ORDER BY created_at DESC", [tenantId]);
    return rows.map(rowToDiscoverySchedule);
  }

  async listDue(atIso: string): Promise<DiscoverySchedule[]> {
    const { rows } = await this.db.query("SELECT * FROM discovery_schedules WHERE enabled = TRUE AND next_run_at <= $1", [atIso]);
    return rows.map(rowToDiscoverySchedule);
  }
}

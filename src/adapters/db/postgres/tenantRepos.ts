import type { Pool } from "pg";
import type { Tenant } from "@domain/entities";
import type { TenantRepo } from "@ports/repos";

function rowToTenant(r: any): Tenant {
  return { id: r.id, name: r.name, plan: r.plan, createdAt: r.created_at };
}

export class PgTenantRepo implements TenantRepo {
  constructor(private db: Pool) {}

  async create(t: Tenant): Promise<Tenant> {
    await this.db.query("INSERT INTO tenants (id, name, plan, created_at) VALUES ($1,$2,$3,$4)", [t.id, t.name, t.plan, t.createdAt]);
    return t;
  }

  async findById(id: string): Promise<Tenant | null> {
    const { rows } = await this.db.query("SELECT * FROM tenants WHERE id=$1", [id]);
    return rows[0] ? rowToTenant(rows[0]) : null;
  }

  async update(id: string, patch: Partial<Tenant>): Promise<Tenant | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.db.query("UPDATE tenants SET name=$1, plan=$2 WHERE id=$3", [merged.name, merged.plan, id]);
    return this.findById(id);
  }

  async list(): Promise<Tenant[]> {
    const { rows } = await this.db.query("SELECT * FROM tenants ORDER BY created_at");
    return rows.map(rowToTenant);
  }
}

/** Tenant-plan fields (device_limit, poller_limit) live alongside the domain `Tenant` row but
 * aren't part of the shared `Tenant` port type (that type is also used by exe mode, which has no
 * concept of a plan limit — it enforces its device ceiling via the signed license file instead,
 * see FileLicenseService). Saas-mode-only reads go through this narrower accessor instead of
 * widening the shared domain type for a field only one deployment mode uses. */
export interface TenantPlanRow {
  id: string;
  plan: string;
  deviceLimit: number;
  pollerLimit: number;
}

export async function findTenantPlan(db: Pool, tenantId: string): Promise<TenantPlanRow | null> {
  const { rows } = await db.query("SELECT id, plan, device_limit, poller_limit FROM tenants WHERE id=$1", [tenantId]);
  const r = rows[0];
  return r ? { id: r.id, plan: r.plan, deviceLimit: r.device_limit, pollerLimit: r.poller_limit } : null;
}

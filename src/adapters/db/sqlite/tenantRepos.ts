import type { Database } from "bun:sqlite";
import type { Tenant } from "@domain/entities";
import type { TenantRepo } from "@ports/repos";

function rowToTenant(r: any): Tenant {
  return { id: r.id, name: r.name, plan: r.plan, createdAt: r.created_at };
}

export class SqliteTenantRepo implements TenantRepo {
  constructor(private db: Database) {}

  async create(t: Tenant): Promise<Tenant> {
    this.db
      .query<any, any>("INSERT INTO tenants (id, name, plan, created_at) VALUES ($id,$name,$plan,$created_at)")
      .run({ $id: t.id, $name: t.name, $plan: t.plan, $created_at: t.createdAt });
    return t;
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = this.db.query<any, any>("SELECT * FROM tenants WHERE id=$id").get({ $id: id }) as any;
    return row ? rowToTenant(row) : null;
  }

  async update(id: string, patch: Partial<Tenant>): Promise<Tenant | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    this.db.query<any, any>("UPDATE tenants SET name=$name, plan=$plan WHERE id=$id").run({ $id: id, $name: merged.name, $plan: merged.plan });
    return this.findById(id);
  }

  async list(): Promise<Tenant[]> {
    const rows = this.db.query<any, any>("SELECT * FROM tenants ORDER BY created_at").all() as any[];
    return rows.map(rowToTenant);
  }
}

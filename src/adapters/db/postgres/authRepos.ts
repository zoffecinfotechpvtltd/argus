import type { Pool } from "pg";
import type { Session, User } from "@domain/entities";
import type { SessionRepo, UserRepo } from "@ports/repos";

function rowToUser(r: any): User {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    email: r.email,
    passwordHash: r.password_hash,
    role: r.role,
    forcePasswordReset: r.force_password_reset,
    disabled: r.disabled,
    emailVerifiedAt: r.email_verified_at,
    totpSecret: r.totp_secret,
    totpEnabled: r.totp_enabled,
    failedLoginCount: r.failed_login_count,
    lockedUntil: r.locked_until,
    scopedGroupIds: r.scoped_group_ids ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class PgUserRepo implements UserRepo {
  constructor(private db: Pool) {}

  async create(u: User): Promise<User> {
    await this.db.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, role, force_password_reset, disabled, email_verified_at, totp_secret, totp_enabled, failed_login_count, locked_until, scoped_group_ids, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        u.id,
        u.tenantId,
        u.email.toLowerCase(),
        u.passwordHash,
        u.role,
        u.forcePasswordReset,
        u.disabled,
        u.emailVerifiedAt,
        u.totpSecret,
        u.totpEnabled,
        u.failedLoginCount,
        u.lockedUntil,
        u.scopedGroupIds ? JSON.stringify(u.scopedGroupIds) : null,
        u.createdAt,
        u.updatedAt,
      ]
    );
    return u;
  }

  async update(tenantId: string, id: string, patch: Partial<User>): Promise<User | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.db.query(
      `UPDATE users SET email=$1, password_hash=$2, role=$3, force_password_reset=$4, disabled=$5, email_verified_at=$6,
       totp_secret=$7, totp_enabled=$8, failed_login_count=$9, locked_until=$10, scoped_group_ids=$11, updated_at=$12
       WHERE id=$13 AND tenant_id=$14`,
      [
        merged.email.toLowerCase(),
        merged.passwordHash,
        merged.role,
        merged.forcePasswordReset,
        merged.disabled,
        merged.emailVerifiedAt,
        merged.totpSecret,
        merged.totpEnabled,
        merged.failedLoginCount,
        merged.lockedUntil,
        merged.scopedGroupIds ? JSON.stringify(merged.scopedGroupIds) : null,
        new Date().toISOString(),
        id,
        tenantId,
      ]
    );
    return this.findById(tenantId, id);
  }

  async findById(tenantId: string, id: string): Promise<User | null> {
    const { rows } = await this.db.query("SELECT * FROM users WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findByIdAnyTenant(id: string): Promise<User | null> {
    const { rows } = await this.db.query("SELECT * FROM users WHERE id=$1", [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findByEmail(tenantId: string, email: string): Promise<User | null> {
    const { rows } = await this.db.query("SELECT * FROM users WHERE email=$1 AND tenant_id=$2", [email.toLowerCase(), tenantId]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findByEmailAnyTenant(email: string): Promise<User | null> {
    const { rows } = await this.db.query("SELECT * FROM users WHERE email=$1 LIMIT 1", [email.toLowerCase()]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async list(tenantId: string): Promise<User[]> {
    const { rows } = await this.db.query("SELECT * FROM users WHERE tenant_id=$1 ORDER BY email", [tenantId]);
    return rows.map(rowToUser);
  }

  async countAll(): Promise<number> {
    const { rows } = await this.db.query("SELECT COUNT(*)::int as c FROM users");
    return rows[0].c;
  }
}

function rowToSession(r: any): Session {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    ip: r.ip,
    userAgent: r.user_agent,
  };
}

export class PgSessionRepo implements SessionRepo {
  constructor(private db: Pool) {}

  async create(s: Session): Promise<Session> {
    await this.db.query(
      "INSERT INTO sessions (id, tenant_id, user_id, created_at, expires_at, revoked_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [s.id, s.tenantId, s.userId, s.createdAt, s.expiresAt, s.revokedAt, s.ip ?? null, s.userAgent ?? null]
    );
    return s;
  }

  async findById(id: string): Promise<Session | null> {
    const { rows } = await this.db.query("SELECT * FROM sessions WHERE id=$1", [id]);
    return rows[0] ? rowToSession(rows[0]) : null;
  }

  async revoke(id: string): Promise<void> {
    await this.db.query("UPDATE sessions SET revoked_at=$1 WHERE id=$2", [new Date().toISOString(), id]);
  }

  async listByUser(tenantId: string, userId: string): Promise<Session[]> {
    const { rows } = await this.db.query("SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC", [tenantId, userId]);
    return rows.map(rowToSession);
  }
}

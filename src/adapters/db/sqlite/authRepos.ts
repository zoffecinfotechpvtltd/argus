import type { Database } from "bun:sqlite";
import type { Session, User } from "@domain/entities";
import type { SessionRepo, UserRepo } from "@ports/repos";

function rowToUser(r: any): User {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    email: r.email,
    passwordHash: r.password_hash,
    role: r.role,
    forcePasswordReset: !!r.force_password_reset,
    disabled: !!r.disabled,
    emailVerifiedAt: r.email_verified_at,
    totpSecret: r.totp_secret,
    totpEnabled: !!r.totp_enabled,
    failedLoginCount: r.failed_login_count ?? 0,
    lockedUntil: r.locked_until,
    scopedGroupIds: r.scoped_group_ids ? JSON.parse(r.scoped_group_ids) : null,
    onboardingCompletedAt: r.onboarding_completed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class SqliteUserRepo implements UserRepo {
  constructor(private db: Database) {}

  async create(u: User): Promise<User> {
    this.db
      .query<any, any>(
        `INSERT INTO users (id, tenant_id, email, password_hash, role, force_password_reset, disabled, email_verified_at, totp_secret, totp_enabled, failed_login_count, locked_until, scoped_group_ids, onboarding_completed_at, created_at, updated_at)
         VALUES ($id,$tenant_id,$email,$password_hash,$role,$force_password_reset,$disabled,$email_verified_at,$totp_secret,$totp_enabled,$failed_login_count,$locked_until,$scoped_group_ids,$onboarding_completed_at,$created_at,$updated_at)`
      )
      .run({
        $id: u.id,
        $tenant_id: u.tenantId,
        $email: u.email.toLowerCase(),
        $password_hash: u.passwordHash,
        $role: u.role,
        $force_password_reset: u.forcePasswordReset ? 1 : 0,
        $disabled: u.disabled ? 1 : 0,
        $email_verified_at: u.emailVerifiedAt,
        $totp_secret: u.totpSecret ?? null,
        $totp_enabled: u.totpEnabled ? 1 : 0,
        $failed_login_count: u.failedLoginCount ?? 0,
        $locked_until: u.lockedUntil ?? null,
        $scoped_group_ids: u.scopedGroupIds ? JSON.stringify(u.scopedGroupIds) : null,
        $onboarding_completed_at: u.onboardingCompletedAt ?? null,
        $created_at: u.createdAt,
        $updated_at: u.updatedAt,
      });
    return u;
  }

  async update(tenantId: string, id: string, patch: Partial<User>): Promise<User | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    this.db
      .query<any, any>(
        `UPDATE users SET email=$email, password_hash=$password_hash, role=$role, force_password_reset=$force_password_reset,
         disabled=$disabled, email_verified_at=$email_verified_at, totp_secret=$totp_secret, totp_enabled=$totp_enabled,
         failed_login_count=$failed_login_count, locked_until=$locked_until, scoped_group_ids=$scoped_group_ids,
         onboarding_completed_at=$onboarding_completed_at, updated_at=$updated_at WHERE id=$id AND tenant_id=$tenant_id`
      )
      .run({
        $id: id,
        $tenant_id: tenantId,
        $email: merged.email.toLowerCase(),
        $password_hash: merged.passwordHash,
        $role: merged.role,
        $force_password_reset: merged.forcePasswordReset ? 1 : 0,
        $disabled: merged.disabled ? 1 : 0,
        $email_verified_at: merged.emailVerifiedAt,
        $totp_secret: merged.totpSecret ?? null,
        $totp_enabled: merged.totpEnabled ? 1 : 0,
        $failed_login_count: merged.failedLoginCount ?? 0,
        $locked_until: merged.lockedUntil ?? null,
        $scoped_group_ids: merged.scopedGroupIds ? JSON.stringify(merged.scopedGroupIds) : null,
        $onboarding_completed_at: merged.onboardingCompletedAt ?? null,
        $updated_at: new Date().toISOString(),
      });
    return this.findById(tenantId, id);
  }

  async findById(tenantId: string, id: string): Promise<User | null> {
    const row = this.db.query<any, any>("SELECT * FROM users WHERE id=$id AND tenant_id=$tenant_id").get({ $id: id, $tenant_id: tenantId });
    return row ? rowToUser(row) : null;
  }

  async findByIdAnyTenant(id: string): Promise<User | null> {
    const row = this.db.query<any, any>("SELECT * FROM users WHERE id=$id").get({ $id: id });
    return row ? rowToUser(row) : null;
  }

  async findByEmail(tenantId: string, email: string): Promise<User | null> {
    const row = this.db
      .query<any, any>("SELECT * FROM users WHERE email=$email AND tenant_id=$tenant_id")
      .get({ $email: email.toLowerCase(), $tenant_id: tenantId });
    return row ? rowToUser(row) : null;
  }

  async findByEmailAnyTenant(email: string): Promise<User | null> {
    const row = this.db.query<any, any>("SELECT * FROM users WHERE email=$email LIMIT 1").get({ $email: email.toLowerCase() });
    return row ? rowToUser(row) : null;
  }

  async list(tenantId: string): Promise<User[]> {
    const rows = this.db.query<any, any>("SELECT * FROM users WHERE tenant_id=$tenant_id ORDER BY email").all({ $tenant_id: tenantId });
    return rows.map(rowToUser);
  }

  async countAll(): Promise<number> {
    return (this.db.query<any, any>("SELECT COUNT(*) as c FROM users").get() as any).c as number;
  }
}

export class SqliteSessionRepo implements SessionRepo {
  constructor(private db: Database) {}

  async create(s: Session): Promise<Session> {
    this.db
      .query<any, any>(
        `INSERT INTO sessions (id, tenant_id, user_id, created_at, expires_at, revoked_at, ip, user_agent)
         VALUES ($id,$tenant_id,$user_id,$created_at,$expires_at,$revoked_at,$ip,$user_agent)`
      )
      .run({
        $id: s.id,
        $tenant_id: s.tenantId,
        $user_id: s.userId,
        $created_at: s.createdAt,
        $expires_at: s.expiresAt,
        $revoked_at: s.revokedAt,
        $ip: s.ip ?? null,
        $user_agent: s.userAgent ?? null,
      });
    return s;
  }

  async findById(id: string): Promise<Session | null> {
    const row = this.db.query<any, any>("SELECT * FROM sessions WHERE id=$id").get({ $id: id }) as any;
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      ip: row.ip,
      userAgent: row.user_agent,
    };
  }

  async revoke(id: string): Promise<void> {
    this.db.query<any, any>("UPDATE sessions SET revoked_at=$now WHERE id=$id").run({ $id: id, $now: new Date().toISOString() });
  }

  async listByUser(tenantId: string, userId: string): Promise<Session[]> {
    const rows = this.db
      .query<any, any>("SELECT * FROM sessions WHERE tenant_id=$tenant_id AND user_id=$user_id ORDER BY created_at DESC")
      .all({ $tenant_id: tenantId, $user_id: userId }) as any[];
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      ip: row.ip,
      userAgent: row.user_agent,
    }));
  }
}

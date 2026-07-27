import { randomUUID } from "node:crypto";
import type { AppContainer } from "@ports/context";
import type { Role, User } from "@domain/entities";

export class DuplicateUserError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists`);
    this.name = "DuplicateUserError";
  }
}

export interface InviteUserInput {
  email: string;
  role: Role;
  passwordHash: string;
}

export async function inviteUser(app: AppContainer, tenantId: string, actorUserId: string, input: InviteUserInput): Promise<User> {
  const existing = await app.repos.user.findByEmail(tenantId, input.email);
  if (existing) throw new DuplicateUserError(input.email);

  const now = app.clock.nowIso();
  const user = await app.repos.user.create({
    id: randomUUID(),
    tenantId,
    email: input.email,
    passwordHash: input.passwordHash,
    role: input.role,
    forcePasswordReset: true,
    disabled: false,
    emailVerifiedAt: now, // invited directly by a trusted admin within their own tenant — not a self-service signup, nothing to verify
    totpSecret: null,
    totpEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
  });

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "user.invite",
    entityType: "user",
    entityId: user.id,
    detail: { email: user.email, role: user.role },
    createdAt: now,
  });

  return user;
}

export async function setUserRole(app: AppContainer, tenantId: string, actorUserId: string, targetUserId: string, role: Role): Promise<User | null> {
  const updated = await app.repos.user.update(tenantId, targetUserId, { role });
  if (!updated) return null;
  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "user.role_change",
    entityType: "user",
    entityId: targetUserId,
    detail: { role },
    createdAt: app.clock.nowIso(),
  });
  return updated;
}

export async function setUserDisabled(
  app: AppContainer,
  tenantId: string,
  actorUserId: string,
  targetUserId: string,
  disabled: boolean
): Promise<User | null> {
  const updated = await app.repos.user.update(tenantId, targetUserId, { disabled });
  if (!updated) return null;

  if (disabled) {
    const sessions = await app.repos.session.listByUser(tenantId, targetUserId);
    for (const s of sessions) if (!s.revokedAt) await app.repos.session.revoke(s.id);
  }

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: disabled ? "user.disable" : "user.enable",
    entityType: "user",
    entityId: targetUserId,
    detail: null,
    createdAt: app.clock.nowIso(),
  });
  return updated;
}

export async function changePassword(
  app: AppContainer,
  tenantId: string,
  actorUserId: string,
  targetUserId: string,
  newPasswordHash: string,
  clearForceReset = true
): Promise<User | null> {
  const updated = await app.repos.user.update(tenantId, targetUserId, {
    passwordHash: newPasswordHash,
    forcePasswordReset: !clearForceReset,
  });
  if (!updated) return null;

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "user.password_change",
    entityType: "user",
    entityId: targetUserId,
    detail: { self: actorUserId === targetUserId },
    createdAt: app.clock.nowIso(),
  });
  return updated;
}

export async function revokeSession(app: AppContainer, tenantId: string, actorUserId: string, sessionId: string): Promise<void> {
  await app.repos.session.revoke(sessionId);
  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "session.revoke",
    entityType: "session",
    entityId: sessionId,
    detail: null,
    createdAt: app.clock.nowIso(),
  });
}

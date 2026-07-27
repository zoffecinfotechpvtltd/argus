import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { hashPassword, signPasswordResetToken, verifyPassword, verifyPasswordResetToken } from "@adapters/crypto";
import { generateTotpSecret, totpUri, verifyTotp } from "@adapters/totp";
import { validateJson, getValidated } from "@api/middleware/validate";
import { createSession, setSessionCookie, clearSessionCookie, issueCsrfCookie, requireAuth, getClientIp, SESSION_COOKIE } from "@api/middleware/auth";
import { rateLimit } from "@api/middleware/rateLimit";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "@api/honoTypes";
import { getLanUrl } from "@adapters/notify/systemEmail";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

/** Per-account lockout — independent of, and in addition to, the per-IP limiter on this route.
 * A distributed attacker (many source IPs) can't be stopped by an IP-keyed limiter alone; this
 * closes that gap by tracking failures against the account itself. */
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

export function authRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.post("/auth/login", rateLimit({ max: 10, windowMs: 60_000, keyPrefix: "login", keyFn: getClientIp }), validateJson(LoginSchema), async (c) => {
    const { email, password, totpCode } = getValidated<typeof LoginSchema>(c);
    // Tenant-agnostic on purpose: a login form has no workspace context yet (no session exists
    // until this succeeds), so the lookup itself has to find the tenant, not assume one. Exe mode
    // has exactly one tenant so this is equivalent to the old DEFAULT_TENANT_ID-scoped lookup it
    // replaced; saas mode genuinely needs it (see UserRepo.findByEmailAnyTenant's doc comment).
    const user = await app.repos.user.findByEmailAnyTenant(email);
    const now = app.clock.now();

    if (user?.lockedUntil && new Date(user.lockedUntil) > now) {
      return c.json({ error: "ACCOUNT_LOCKED" }, 423);
    }

    // Constant-time-ish: always run a hash verify even on unknown user to avoid timing user-enumeration.
    const dummyHash = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const ok = await verifyPassword(password, user?.passwordHash ?? dummyHash);

    if (!user || !ok || user.disabled) {
      if (user) await recordLoginFailure(app, user.id, user.tenantId, user.failedLoginCount);
      return c.json({ error: "INVALID_CREDENTIALS" }, 401);
    }
    if (!user.emailVerifiedAt) {
      return c.json({ error: "EMAIL_NOT_VERIFIED" }, 403);
    }

    if (user.totpEnabled) {
      if (!totpCode) return c.json({ error: "TOTP_REQUIRED" }, 401);
      if (!user.totpSecret || !verifyTotp(user.totpSecret, totpCode, now.getTime())) {
        await recordLoginFailure(app, user.id, user.tenantId, user.failedLoginCount);
        return c.json({ error: "INVALID_TOTP" }, 401);
      }
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await app.repos.user.update(user.tenantId, user.id, { failedLoginCount: 0, lockedUntil: null });
    }

    const session = await createSession(app, user, getClientIp(c), c.req.header("user-agent"));
    setSessionCookie(c, session.id);
    const csrf = issueCsrfCookie(c);

    await app.repos.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      detail: null,
      createdAt: app.clock.now().toISOString(),
    });

    return c.json({
      ok: true,
      user: { id: user.id, email: user.email, role: user.role, forcePasswordReset: user.forcePasswordReset },
      csrfToken: csrf,
    });
  });

  const ForgotPasswordSchema = z.object({ email: z.string().email() });

  router.post(
    "/auth/forgot-password",
    rateLimit({ max: 5, windowMs: 60_000, keyPrefix: "forgot-password", keyFn: getClientIp }),
    validateJson(ForgotPasswordSchema),
    async (c) => {
      const { email } = getValidated<typeof ForgotPasswordSchema>(c);
      // Tenant-agnostic — same reasoning as /auth/login above (no workspace context at this point).
      const user = await app.repos.user.findByEmailAnyTenant(email);
      // Always the same response regardless of whether the email exists — otherwise this endpoint
      // becomes a user-enumeration oracle (the same reasoning /auth/login's dummy-hash verify follows).
      if (user && !user.disabled) {
        const token = signPasswordResetToken(app.instanceKey, user.id, user.passwordHash);
        const resetUrl = `${getLanUrl(app.config.port)}/reset-password?uid=${encodeURIComponent(user.id)}&token=${encodeURIComponent(token)}`;
        await app.systemEmail.send(user.tenantId, {
          to: user.email,
          subject: "Reset your Argus password",
          text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
          html: `<p>Reset your password by clicking the link below:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
        });
      }
      return c.json({ ok: true });
    }
  );

  const ResetPasswordSchema = z.object({
    userId: z.string(),
    token: z.string(),
    newPassword: z.string().min(10, "Password must be at least 10 characters"),
  });

  router.post(
    "/auth/reset-password",
    rateLimit({ max: 10, windowMs: 60_000, keyPrefix: "reset-password", keyFn: getClientIp }),
    validateJson(ResetPasswordSchema),
    async (c) => {
      const { userId, token, newPassword } = getValidated<typeof ResetPasswordSchema>(c);
      // Tenant-agnostic — the signed token itself (verified below) is the authorization, same
      // reasoning as the one-click alert-ack link (AlertRepo.findByIdAnyTenant).
      const user = await app.repos.user.findByIdAnyTenant(userId);
      if (!user || user.disabled || !verifyPasswordResetToken(app.instanceKey, user.id, user.passwordHash, token)) {
        return c.json({ error: "INVALID_OR_EXPIRED_TOKEN" }, 400);
      }
      await app.repos.user.update(user.tenantId, user.id, {
        passwordHash: await hashPassword(newPassword),
        forcePasswordReset: false,
        failedLoginCount: 0,
        lockedUntil: null,
      });
      await app.repos.audit.record({
        tenantId: user.tenantId,
        userId: user.id,
        action: "user.password_reset",
        entityType: "user",
        entityId: user.id,
        detail: { via: "self-service-link" },
        createdAt: app.clock.nowIso(),
      });
      return c.json({ ok: true });
    }
  );

  router.post("/auth/logout", requireAuth(app), async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) await app.repos.session.revoke(sessionId);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  router.get("/auth/me", requireAuth(app), async (c) => {
    const user = c.get("user");
    return c.json({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      forcePasswordReset: user.forcePasswordReset,
      totpEnabled: user.totpEnabled,
    });
  });

  // --- TOTP 2FA self-enrollment (any signed-in user manages their own — not admin-gated) ---

  router.post("/auth/totp/enroll", requireAuth(app), async (c) => {
    const user = c.get("user");
    const secret = generateTotpSecret();
    // Stored but not yet "enabled" — /auth/totp/verify below flips it on only after the user proves
    // they actually scanned/entered it correctly, so a half-finished enrollment can never lock
    // someone out of their own account.
    await app.repos.user.update(user.tenantId, user.id, { totpSecret: secret });
    return c.json({ secret, uri: totpUri(secret, user.email) });
  });

  const TotpVerifySchema = z.object({ code: z.string() });

  router.post("/auth/totp/verify", requireAuth(app), validateJson(TotpVerifySchema), async (c) => {
    const user = c.get("user");
    const { code } = getValidated<typeof TotpVerifySchema>(c);
    if (!user.totpSecret || !verifyTotp(user.totpSecret, code)) {
      return c.json({ error: "INVALID_TOTP" }, 400);
    }
    await app.repos.user.update(user.tenantId, user.id, { totpEnabled: true });
    await app.repos.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.totp_enable",
      entityType: "user",
      entityId: user.id,
      detail: null,
      createdAt: app.clock.nowIso(),
    });
    return c.json({ ok: true });
  });

  router.post("/auth/totp/disable", requireAuth(app), async (c) => {
    const user = c.get("user");
    await app.repos.user.update(user.tenantId, user.id, { totpEnabled: false, totpSecret: null });
    await app.repos.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.totp_disable",
      entityType: "user",
      entityId: user.id,
      detail: null,
      createdAt: app.clock.nowIso(),
    });
    return c.json({ ok: true });
  });

  return router;
}

async function recordLoginFailure(app: AppContainer, userId: string, tenantId: string, currentCount: number): Promise<void> {
  const newCount = currentCount + 1;
  const lockedUntil = newCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
  await app.repos.user.update(tenantId, userId, { failedLoginCount: newCount, lockedUntil });
}

import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AppContainer } from "@bootstrap/container";
import { hashPassword } from "@adapters/crypto";
import { validateJson, getValidated } from "@api/middleware/validate";
import { createSession, setSessionCookie, issueCsrfCookie, getClientIp } from "@api/middleware/auth";
import { rateLimit } from "@api/middleware/rateLimit";
import type { AppEnv } from "@api/honoTypes";

const SignupSchema = z.object({
  workspaceName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

/**
 * Saas-mode-only (registered in server.ts only when `config.mode === "saas"`). The multi-tenant
 * counterpart to exe mode's `/setup` — that route seeds the one fixed `"local"` tenant once ever;
 * this one creates a brand-new tenant + its first admin user on every call. New tenants land on
 * the `plan='free'` / `device_limit=50` / `poller_limit=1` defaults baked into the Postgres schema
 * (migrations-pg/0001_init.sql) — no explicit tier assignment needed here.
 *
 * Known gap, not silently glossed over: tenant creation and user creation are two separate inserts,
 * not one Postgres transaction (a mid-request crash between them would leave an orphaned tenant row
 * with no user). Full cross-repo transactional signup is real work disproportionate to M0's actual
 * verification test (sign up → log in → tier shows → limit enforced) — tracked as a follow-up, not
 * silently accepted as "fine forever."
 */
export function signupRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.post("/signup", rateLimit({ max: 5, windowMs: 60_000, keyPrefix: "signup" }), validateJson(SignupSchema), async (c) => {
    const body = getValidated<typeof SignupSchema>(c);
    const now = app.clock.nowIso();

    // No cross-tenant "is this email already in use anywhere" check yet — `UserRepo.findByEmail`
    // is deliberately tenant-scoped (see its port doc), so the same email can sign up for a second,
    // separate workspace today. That's arguably fine (one person legitimately running two
    // workspaces) but hasn't been decided as a product rule — noted here so it's a decision made
    // later, not a bug discovered later.

    const tenant = await app.repos.tenant.create({ id: randomUUID(), name: body.workspaceName, plan: "free", createdAt: now });

    const user = await app.repos.user.create({
      id: randomUUID(),
      tenantId: tenant.id,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      role: "admin",
      forcePasswordReset: false,
      disabled: false,
      // No verification-email flow exists anywhere in this codebase yet (setup.ts and users.ts both
      // auto-verify because neither is self-service). Setting this to null here would permanently
      // lock every saas signup out at login with no way to ever verify — not a real "pending
      // verification" state, just a broken one. Auto-verifying until a real email-verification
      // milestone exists; tracked as a gap, not silently accepted as final.
      emailVerifiedAt: now,
      totpSecret: null,
      totpEnabled: false,
      failedLoginCount: 0,
      lockedUntil: null,
      onboardingCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await app.repos.audit.record({
      tenantId: tenant.id,
      userId: user.id,
      action: "signup.complete",
      entityType: "tenant",
      entityId: tenant.id,
      detail: { email: user.email, workspaceName: tenant.name },
      createdAt: now,
    });

    const session = await createSession(app, user, getClientIp(c), c.req.header("user-agent"));
    setSessionCookie(c, session.id);
    const csrf = issueCsrfCookie(c);

    return c.json({ ok: true, user: { id: user.id, email: user.email, role: user.role }, workspace: { id: tenant.id, name: tenant.name }, csrfToken: csrf });
  });

  return router;
}

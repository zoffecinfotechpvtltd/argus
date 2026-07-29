import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AppContainer } from "@bootstrap/container";
import { DEFAULT_TENANT_ID } from "@domain/entities";
import { hashPassword } from "@adapters/crypto";
import { validateJson, getValidated } from "@api/middleware/validate";
import { createSession, setSessionCookie, issueCsrfCookie, getClientIp } from "@api/middleware/auth";
import { rateLimit } from "@api/middleware/rateLimit";
import type { AppEnv } from "@api/honoTypes";

export const TERMS_VERSION = "1.0";

export const TERMS_TEXT = `Argus — Terms of Use (v${TERMS_VERSION})

1. This software monitors devices on networks you configure it to scan or that you add manually.
   You are responsible for having authorization to scan and monitor every network and device you
   point Argus at. Unauthorized network scanning may violate laws or acceptable-use policies.

2. Argus stores device inventory, metrics, alert history, and credentials you provide (e.g. SNMP
   community strings) locally in its data directory. Credentials are encrypted at rest; other data
   is not. Back up and secure this data directory as you would any system holding operational data.

3. Notification integrations (SMTP, webhooks) send data you configure to third-party
   services you choose. Argus is not responsible for the availability or security practices of
   those third-party services.

4. This software is provided "as is", without warranty of any kind. You assume all risk for its use
   in your environment, including any impact of active network scanning on production systems.

5. Continuing past this screen records your acceptance (email, timestamp, and this terms version)
   in the audit log for the life of this installation.`;

const SetupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  instanceName: z.string().min(1).max(120).optional(),
  acceptedTerms: z.boolean().refine((v) => v === true, "You must accept the Terms and Conditions to continue"),
});

export function setupRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.post("/setup", rateLimit({ max: 5, windowMs: 60_000, keyPrefix: "setup" }), validateJson(SetupSchema), async (c) => {
    const existing = await app.repos.user.countAll();
    if (existing > 0) return c.json({ error: "ALREADY_SET_UP" }, 409);

    const body = getValidated<typeof SetupSchema>(c);
    const now = app.clock.now().toISOString();
    const user = await app.repos.user.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      role: "admin",
      forcePasswordReset: false,
      disabled: false,
      emailVerifiedAt: now, // exe-mode's local admin is created via a physically-present-on-the-LAN setup flow, not email signup — nothing to verify
      totpSecret: null,
      totpEnabled: false,
      failedLoginCount: 0,
      lockedUntil: null,
      onboardingCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    if (body.instanceName) {
      await app.repos.settings.set(DEFAULT_TENANT_ID, "instanceName", body.instanceName);
    }

    await app.repos.settings.set(DEFAULT_TENANT_ID, "terms.acceptedAt", now);
    await app.repos.settings.set(DEFAULT_TENANT_ID, "terms.version", TERMS_VERSION);
    await app.repos.settings.set(DEFAULT_TENANT_ID, "terms.acceptedBy", user.email);

    await app.repos.audit.record({
      tenantId: DEFAULT_TENANT_ID,
      userId: user.id,
      action: "setup.complete",
      entityType: "tenant",
      entityId: DEFAULT_TENANT_ID,
      detail: { email: user.email, termsVersion: TERMS_VERSION, termsAccepted: true },
      createdAt: now,
    });

    const session = await createSession(app, user, getClientIp(c), c.req.header("user-agent"));
    setSessionCookie(c, session.id);
    const csrf = issueCsrfCookie(c);

    return c.json({ ok: true, user: { id: user.id, email: user.email, role: user.role }, csrfToken: csrf });
  });

  router.get("/setup/status", async (c) => {
    const count = await app.repos.user.countAll();
    return c.json({ setupRequired: count === 0 });
  });

  router.get("/setup/terms", (c) => {
    return c.json({ version: TERMS_VERSION, text: TERMS_TEXT });
  });

  return router;
}

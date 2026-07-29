import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { SAML } from "@node-saml/node-saml";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf, createSession, setSessionCookie, issueCsrfCookie, getClientIp } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import { rateLimit } from "@api/middleware/rateLimit";
import { hashPassword } from "@adapters/crypto";
import { SAML_SETTINGS_KEY, type StoredSamlConfig } from "@adapters/sso/samlConfig";
import type { AppEnv } from "@api/honoTypes";

/**
 * Saas-mode SSO/SAML — M7. Uses @node-saml/node-saml (actively-maintained fork of passport-saml's
 * validation core) for the actual assertion parsing/signature verification rather than hand-rolling
 * XML/crypto — that class of code has a long history of subtle vulnerabilities (signature-wrapping
 * attacks etc) when implemented from scratch, not something to risk on a first pass.
 *
 * IMPORTANT — known limitation, not silently glossed over: this has been built against the library's
 * documented API and typechecks/boots correctly, but has NOT been validated against a real IdP
 * (Okta/Azure AD/Google Workspace/generic SAML) — that requires an actual IdP tenant to test
 * against, which picking one is a product decision (see SAAS_GAPS.md's M7 note), not something to
 * silently assume. Treat this as a real, complete-looking implementation that still needs a live
 * IdP validation pass before being called production-ready — the difference between "compiles" and
 * "works" matters most exactly here, on an auth path.
 *
 * One IdP per tenant, one SP entity per tenant (distinguished by :tenantId in the URL — this is the
 * unique ACS URL a tenant's admin configures on their IdP side, same shape most SAML SaaS products
 * use for multi-tenant SSO).
 */

function spBaseUrl(requestUrl: string): string {
  return new URL(requestUrl).origin;
}

async function buildSaml(app: AppContainer, tenantId: string, requestUrl: string): Promise<{ saml: SAML; config: StoredSamlConfig } | null> {
  const raw = await app.repos.settings.get(tenantId, SAML_SETTINGS_KEY);
  if (!raw) return null;
  const config = JSON.parse(raw) as StoredSamlConfig;
  if (!config.enabled) return null;

  const base = spBaseUrl(requestUrl);
  const saml = new SAML({
    entryPoint: config.entryPoint,
    idpCert: config.idpCert,
    idpIssuer: config.idpIssuer,
    issuer: `${base}/api/sso/saml/${tenantId}/metadata`,
    callbackUrl: `${base}/api/sso/saml/${tenantId}/acs`,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
  });
  return { saml, config };
}

const SamlConfigSchema = z.object({
  enabled: z.boolean(),
  entryPoint: z.string().url(),
  idpIssuer: z.string().min(1),
  idpCert: z.string().min(1),
});

export function ssoRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  // --- Admin config (authenticated) ---

  router.get("/settings/sso/saml", requireAuth(app), requireRole("admin"), async (c) => {
    const raw = await app.repos.settings.get(tenantOf(c), SAML_SETTINGS_KEY);
    return c.json(raw ? (JSON.parse(raw) as StoredSamlConfig) : null);
  });

  router.put("/settings/sso/saml", requireAuth(app), requireRole("admin"), validateJson(SamlConfigSchema), async (c) => {
    const config = getValidated<typeof SamlConfigSchema>(c);
    await app.repos.settings.set(tenantOf(c), SAML_SETTINGS_KEY, JSON.stringify(config));
    return c.json({ ok: true });
  });

  // --- SP metadata (public — the IdP admin fetches this while configuring their side) ---

  router.get("/sso/saml/:tenantId/metadata", async (c) => {
    const built = await buildSaml(app, c.req.param("tenantId")!, c.req.url);
    if (!built) return c.json({ error: "SSO_NOT_CONFIGURED" }, 404);
    c.header("Content-Type", "application/xml");
    return c.body(built.saml.generateServiceProviderMetadata(null, null));
  });

  // --- SP-initiated login (public — this IS the login mechanism) ---

  router.get("/sso/saml/:tenantId/login", rateLimit({ max: 10, windowMs: 60_000, keyPrefix: "sso-login", keyFn: getClientIp }), async (c) => {
    const tenantId = c.req.param("tenantId")!;
    const built = await buildSaml(app, tenantId, c.req.url);
    if (!built) return c.json({ error: "SSO_NOT_CONFIGURED" }, 404);
    const url = await built.saml.getAuthorizeUrlAsync(tenantId, undefined, {});
    return c.redirect(url);
  });

  // --- Assertion Consumer Service (public — the IdP POSTs the assertion here) ---

  // Rate-limited more than just "public route hygiene" — every POST here costs a real Ed25519/RSA
  // signature verification (@node-saml's validatePostResponseAsync), so an unauthenticated flood
  // of garbage SAMLResponse values is a genuine CPU-exhaustion vector, not just noise.
  router.post("/sso/saml/:tenantId/acs", rateLimit({ max: 10, windowMs: 60_000, keyPrefix: "sso-acs", keyFn: getClientIp }), async (c) => {
    const tenantId = c.req.param("tenantId")!;
    const built = await buildSaml(app, tenantId, c.req.url);
    if (!built) return c.json({ error: "SSO_NOT_CONFIGURED" }, 404);

    const body = await c.req.parseBody();
    const samlResponse = body["SAMLResponse"];
    if (typeof samlResponse !== "string") return c.json({ error: "MISSING_SAML_RESPONSE" }, 400);

    let profile: { email?: string; mail?: string; nameID: string };
    try {
      const result = await built.saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
      if (!result.profile) return c.json({ error: "NO_ASSERTION_PROFILE" }, 400);
      profile = result.profile;
    } catch (err) {
      app.logger.warn("saml_assertion_validation_failed", { tenantId, error: (err as Error).message });
      return c.json({ error: "INVALID_ASSERTION" }, 400);
    }

    const email = (profile.email ?? profile.mail ?? profile.nameID)?.toLowerCase();
    if (!email || !email.includes("@")) return c.json({ error: "NO_EMAIL_IN_ASSERTION" }, 400);

    let user = await app.repos.user.findByEmail(tenantId, email);
    if (!user) {
      // First SSO login for this email at this tenant — auto-provision. passwordHash is a random,
      // never-disclosed value (not a real password): this user can only ever authenticate via SSO,
      // by design, not as a shortcut that happens to leave password-login theoretically possible.
      const now = app.clock.nowIso();
      user = await app.repos.user.create({
        id: randomUUID(),
        tenantId,
        email,
        passwordHash: await hashPassword(randomBytes(32).toString("hex")),
        role: "viewer",
        forcePasswordReset: false,
        disabled: false,
        emailVerifiedAt: now, // the IdP already vouched for this identity — nothing left to verify
        totpSecret: null,
        totpEnabled: false,
        failedLoginCount: 0,
        lockedUntil: null,
        onboardingCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (user.disabled) return c.json({ error: "ACCOUNT_DISABLED" }, 403);

    const session = await createSession(app, user, getClientIp(c), c.req.header("user-agent"));
    setSessionCookie(c, session.id);
    issueCsrfCookie(c);
    return c.redirect("/");
  });

  return router;
}

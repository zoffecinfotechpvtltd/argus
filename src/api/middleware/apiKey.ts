import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context as HonoContext, Next } from "hono";
import type { AppContainer } from "@bootstrap/container";
import type { User } from "@domain/entities";
import { requireAuth } from "@api/middleware/auth";
import type { AppEnv } from "@api/honoTypes";

type Context = HonoContext<AppEnv>;

const KEY_PREFIX_BYTES = 6;
const KEY_SECRET_BYTES = 24;

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Generates one new key: `argus_<12-hex-prefix>_<48-hex-secret>`. The prefix is stored in the
 * clear for O(1) lookup (it isn't secret — knowing it proves nothing without the secret half); the
 * secret half is hashed at rest exactly like a password, never stored or logged in plaintext. Only
 * the caller of this function ever sees the full token — it can't be recovered from the DB later,
 * same trade-off as a GitHub personal access token. */
export function generateApiKey(): { prefix: string; token: string; hash: string } {
  const prefix = randomBytes(KEY_PREFIX_BYTES).toString("hex");
  const secret = randomBytes(KEY_SECRET_BYTES).toString("hex");
  return { prefix, token: `argus_${prefix}_${secret}`, hash: hashApiKeySecret(secret) };
}

function syntheticViewerUser(tenantId: string, apiKeyId: string, apiKeyName: string): User {
  return {
    id: `apikey:${apiKeyId}`,
    tenantId,
    email: `api-key:${apiKeyName}`,
    passwordHash: "",
    role: "viewer",
    forcePasswordReset: false,
    disabled: false,
    emailVerifiedAt: null,
    totpSecret: null,
    totpEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    onboardingCompletedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Accepts either the normal session cookie (delegating verbatim to `requireAuth`'s checks) or a
 * Bearer API key (`Authorization: Bearer argus_<prefix>_<secret>`). Deliberately used only on a
 * narrow, hand-picked set of GET routes for external read-only integrations — an
 * API-key-authenticated request is always treated as
 * role "viewer" regardless of who created the key, since every route this guards is read-only.
 * Every key use updates `lastUsedAt` so a stale/forgotten key is visible on the Admin → API Keys
 * page, not silently working forever unnoticed.
 */
export function requireAuthOrApiKey(app: AppContainer) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer argus_")) {
      return requireAuth(app)(c, next);
    }

    const token = authHeader.slice("Bearer ".length);
    const parts = token.split("_");
    if (parts.length !== 3) return c.json({ error: "INVALID_API_KEY" }, 401);
    const [, prefix, secret] = parts;

    const record = await app.repos.apiKey.findByPrefix(prefix!);
    if (!record || record.revokedAt) return c.json({ error: "INVALID_API_KEY" }, 401);

    const expected = Buffer.from(record.keyHash, "hex");
    const actual = Buffer.from(hashApiKeySecret(secret!), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return c.json({ error: "INVALID_API_KEY" }, 401);
    }

    await app.repos.apiKey.touchLastUsed(record.id, app.clock.nowIso());
    c.set("user", syntheticViewerUser(record.tenantId, record.id, record.name));
    c.set("tenantId", record.tenantId);
    await next();
  };
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context as HonoContext, Next } from "hono";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

type Context = HonoContext<AppEnv>;

const TOKEN_PREFIX_BYTES = 6;
const TOKEN_SECRET_BYTES = 24;

export function hashAgentTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Generates one new agent token: `argus_agent_<12-hex-prefix>_<48-hex-secret>` — distinct format
 * from `argus_<prefix>_<secret>` API keys so the two are never visually or programmatically
 * confusable. Same trade-off as an API key: only the caller of this function ever sees the full
 * token, it can't be recovered from the DB later. */
export function generateAgentToken(): { prefix: string; token: string; hash: string } {
  const prefix = randomBytes(TOKEN_PREFIX_BYTES).toString("hex");
  const secret = randomBytes(TOKEN_SECRET_BYTES).toString("hex");
  return { prefix, token: `argus_agent_${prefix}_${secret}`, hash: hashAgentTokenSecret(secret) };
}

/**
 * Authenticates a remote agent's push requests (`Authorization: Bearer argus_agent_<prefix>_<secret>`).
 * Deliberately its own middleware, not a mode of requireAuthOrApiKey — an agent isn't a user
 * (there's no session, no role, nothing to synthesize a viewer identity for) and its token grants a
 * narrow write capability API keys are documented to never have. Sets `c.set("agent", record)`
 * instead of `c.set("user", ...)`; route handlers that accept agent auth read that directly.
 */
export function requireAgentToken(app: AppContainer) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer argus_agent_")) {
      return c.json({ error: "UNAUTHENTICATED" }, 401);
    }

    const token = authHeader.slice("Bearer ".length);
    const parts = token.split("_");
    if (parts.length !== 4) return c.json({ error: "INVALID_AGENT_TOKEN" }, 401);
    const [, , prefix, secret] = parts;

    const record = await app.repos.remoteAgent.findByPrefix(prefix!);
    if (!record || record.revokedAt) return c.json({ error: "INVALID_AGENT_TOKEN" }, 401);

    const expected = Buffer.from(record.tokenHash, "hex");
    const actual = Buffer.from(hashAgentTokenSecret(secret!), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return c.json({ error: "INVALID_AGENT_TOKEN" }, 401);
    }

    await app.repos.remoteAgent.touchLastSeen(record.id, app.clock.nowIso());
    c.set("agent", record);
    c.set("tenantId", record.tenantId);
    await next();
  };
}

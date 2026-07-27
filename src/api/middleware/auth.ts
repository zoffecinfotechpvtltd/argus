import type { Context as HonoContext, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AppContainer } from "@bootstrap/container";
import type { Role, Session, User } from "@domain/entities";
import { DEFAULT_TENANT_ID } from "@domain/entities";
import type { AppEnv } from "@api/honoTypes";

type Context = HonoContext<AppEnv>;

export const SESSION_COOKIE = "np_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** The real TCP peer address via Bun (see AppBindings) — never a client-suppliable header. Used
 * anywhere an address needs to resist spoofing (rate limiting, audit/session logging). */
export function getClientIp(c: Context): string {
  return c.env?.requestIP?.(c.req.raw)?.address ?? "unknown";
}

export async function createSession(app: AppContainer, user: User, ip?: string, userAgent?: string): Promise<Session> {
  const now = app.clock.now();
  const session: Session = {
    id: randomBytes(32).toString("hex"),
    tenantId: user.tenantId,
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    revokedAt: null,
    ip,
    userAgent,
  };
  await app.repos.session.create(session);
  return session;
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    secure: false, // serves plain http://localhost or a LAN address, never TLS
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Constant-time string comparison for secret values received from the client (CSRF tokens,
 * signatures) — a plain `!==` leaks a timing signal proportional to how many leading bytes match. */
function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Requires a valid, non-expired, non-revoked session. Sets `user`, `session`, `tenantId` on context. Mutating routes (except GET/HEAD/OPTIONS) also require a matching X-CSRF-Token header (double-submit). */
export function requireAuth(app: AppContainer) {
  return async (c: Context, next: Next) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!sessionId) return c.json({ error: "UNAUTHENTICATED" }, 401);

    const session = await app.repos.session.findById(sessionId);
    if (!session || session.revokedAt || new Date(session.expiresAt) < app.clock.now()) {
      clearSessionCookie(c);
      return c.json({ error: "UNAUTHENTICATED" }, 401);
    }

    const user = await app.repos.user.findById(session.tenantId, session.userId);
    if (!user || user.disabled) {
      clearSessionCookie(c);
      return c.json({ error: "UNAUTHENTICATED" }, 401);
    }

    const method = c.req.method.toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const csrfCookie = getCookie(c, "np_csrf");
      const csrfHeader = c.req.header("X-CSRF-Token");
      if (!csrfCookie || !csrfHeader || !secureEquals(csrfCookie, csrfHeader)) {
        return c.json({ error: "CSRF_TOKEN_INVALID" }, 403);
      }
    }

    c.set("user", user);
    c.set("session", session);
    c.set("tenantId", user.tenantId);
    await next();
  };
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

/** Route guard: caller's role must be >= minRole. Must run after requireAuth. */
export function requireRole(minRole: Role) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as User | undefined;
    if (!user) return c.json({ error: "UNAUTHENTICATED" }, 401);
    if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
      return c.json({ error: "FORBIDDEN", required: minRole }, 403);
    }
    await next();
  };
}

/** Route guard: if the caller has a non-null `scopedGroupIds` (RBAC group-scoping, M7), the device
 * named by the route's `:id` param must belong to one of those groups, or the request is denied.
 * Must run after requireAuth/requireAuthOrApiKey. Unscoped users (the default — `scopedGroupIds`
 * null/absent) are unaffected. A missing device is left to the route handler's own 404 — only an
 * existing, out-of-scope device produces this 403. Currently wired into the single-device routes in
 * src/api/routes/devices.ts only; the same pattern should extend to other device-scoped routes
 * (checks, metrics, alerts, ...) later — that's a separate, larger change, not done here. */
export function assertGroupAccess(app: AppContainer) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as User | undefined;
    if (!user) return c.json({ error: "UNAUTHENTICATED" }, 401);
    if (user.scopedGroupIds) {
      const id = c.req.param("id");
      if (id) {
        const device = await app.repos.device.findById(tenantOf(c), id);
        if (device && (!device.groupId || !user.scopedGroupIds.includes(device.groupId))) {
          return c.json({ error: "FORBIDDEN", reason: "OUTSIDE_SCOPED_GROUP" }, 403);
        }
      }
    }
    await next();
  };
}

export function issueCsrfCookie(c: Context) {
  const token = randomBytes(24).toString("hex");
  setCookie(c, "np_csrf", token, { httpOnly: false, sameSite: "Lax", path: "/" });
  return token;
}

export function tenantOf(c: Context): string {
  return (c.get("tenantId") as string | undefined) ?? DEFAULT_TENANT_ID;
}

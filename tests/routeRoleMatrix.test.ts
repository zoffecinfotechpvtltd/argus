import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { buildServer } from "@api/server";
import { createSession, SESSION_COOKIE } from "@api/middleware/auth";
import { hashPassword } from "@adapters/crypto";
import { DEFAULT_TENANT_ID, type Role, type User } from "@domain/entities";

type ExpectedRole = "public" | "viewer" | "operator" | "admin";

interface RouteCase {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  minRole: ExpectedRole;
  body?: unknown;
}

// One entry per route the app exposes (excluding /api/setup* and /api/auth/login, which are
// intentionally public before/at setup, and the one-click ack link, which uses a different auth
// mechanism entirely and is covered by its own test).
const ROUTES: RouteCase[] = [
  { method: "GET", path: "/api/devices", minRole: "viewer" },
  { method: "GET", path: "/api/devices/x", minRole: "viewer" },
  { method: "POST", path: "/api/devices", minRole: "operator", body: { name: "n", ip: "10.0.0.99" } },
  { method: "PATCH", path: "/api/devices/x", minRole: "operator", body: { name: "n2" } },
  { method: "DELETE", path: "/api/devices/x", minRole: "operator" },
  { method: "GET", path: "/api/groups", minRole: "viewer" },
  { method: "POST", path: "/api/groups", minRole: "operator", body: { name: "g" } },
  { method: "PATCH", path: "/api/groups/x", minRole: "operator", body: { name: "g2" } },
  { method: "DELETE", path: "/api/groups/x", minRole: "operator" },
  { method: "POST", path: "/api/discovery/scan", minRole: "operator", body: { cidr: "10.0.0.0/30" } },
  { method: "GET", path: "/api/discovery/x", minRole: "viewer" },
  { method: "POST", path: "/api/discovery/import", minRole: "operator", body: { jobId: "x", selections: [{ ip: "1.2.3.4", type: "unknown", openPorts: [] }] } },
  { method: "GET", path: "/api/alerts", minRole: "viewer" },
  { method: "POST", path: "/api/alerts/x/ack", minRole: "operator" },
  { method: "POST", path: "/api/alerts/x/resolve", minRole: "operator" },
  { method: "GET", path: "/api/notifications/log", minRole: "viewer" },
  { method: "GET", path: "/api/settings/notifications", minRole: "admin" },
  { method: "PUT", path: "/api/settings/notifications/smtp", minRole: "admin", body: { host: "h", port: 587, secure: false, from: "a@b.com" } },
  { method: "POST", path: "/api/settings/notifications/smtp/test", minRole: "admin", body: { to: "a@b.com" } },
  { method: "PUT", path: "/api/settings/notifications/webhook", minRole: "admin", body: {} },
  { method: "POST", path: "/api/settings/notifications/webhook/test", minRole: "admin", body: { url: "https://example.com" } },
  { method: "GET", path: "/api/notification-prefs", minRole: "viewer" },
  { method: "PUT", path: "/api/notification-prefs", minRole: "viewer", body: { channels: ["email"], severityFloor: "warning" } },
  { method: "GET", path: "/api/summary", minRole: "viewer" },
  { method: "GET", path: "/api/engine/status", minRole: "viewer" },
  { method: "GET", path: "/api/metrics/x", minRole: "viewer" },
  { method: "GET", path: "/api/reports/sla?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z", minRole: "viewer" },
  { method: "GET", path: "/api/reports/alerts-summary?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z", minRole: "viewer" },
  { method: "GET", path: "/api/topology/positions", minRole: "viewer" },
  { method: "PUT", path: "/api/topology/positions", minRole: "viewer", body: { nodeId: "x", x: 1, y: 1 } },
  { method: "GET", path: "/api/devices/x/checks", minRole: "viewer" },
  { method: "PATCH", path: "/api/checks/x", minRole: "operator", body: { enabled: true } },
  { method: "GET", path: "/api/maintenance", minRole: "viewer" },
  { method: "POST", path: "/api/maintenance", minRole: "operator", body: { startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-01-01T01:00:00.000Z" } },
  { method: "DELETE", path: "/api/maintenance/x", minRole: "operator" },
  { method: "GET", path: "/api/users", minRole: "admin" },
  { method: "POST", path: "/api/users", minRole: "admin", body: { email: "new@test.local", role: "viewer", temporaryPassword: "aaaaaaaaaa" } },
  { method: "PATCH", path: "/api/users/x/role", minRole: "admin", body: { role: "operator" } },
  { method: "PATCH", path: "/api/users/x/disabled", minRole: "admin", body: { disabled: true } },
  { method: "GET", path: "/api/audit", minRole: "admin" },
  { method: "GET", path: "/api/backup", minRole: "admin" },
  { method: "GET", path: "/api/settings/general", minRole: "admin" },
  { method: "GET", path: "/api/settings/update-check", minRole: "admin" },
];

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

async function buildAuthedRequest(app: Awaited<ReturnType<typeof buildTestContainer>>["app"], user: User) {
  const session = await createSession(app, user);
  const csrf = "test-csrf-token";
  return {
    cookie: `${SESSION_COOKIE}=${session.id}; np_csrf=${csrf}`,
    csrfHeader: csrf,
  };
}

describe("Route -> role matrix", () => {
  it("rejects every non-public route with no session (401)", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    // Setup must be "done" (an admin must exist) for the setup-required gate to let requests through.
    await app.repos.user.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      email: "seed-admin@test.local",
      passwordHash: await hashPassword("irrelevant-but-long-enough"),
      role: "admin",
      forcePasswordReset: false,
      disabled: false,
      emailVerifiedAt: app.clock.nowIso(),
      totpSecret: null,
      totpEnabled: false,
      failedLoginCount: 0,
      lockedUntil: null,
      onboardingCompletedAt: null,
      createdAt: app.clock.nowIso(),
      updatedAt: app.clock.nowIso(),
    });

    for (const route of ROUTES) {
      const res = await hono.request(route.path, {
        method: route.method,
        headers: route.body ? { "Content-Type": "application/json" } : undefined,
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status, `${route.method} ${route.path} should 401 with no session`).toBe(401);
    }
  });

  it("enforces the minimum role for every route (403 below, never 401/403 at/above)", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    const now = app.clock.nowIso();

    const users: Record<Role, User> = {} as Record<Role, User>;
    for (const role of ["admin", "operator", "viewer"] as Role[]) {
      users[role] = await app.repos.user.create({
        id: randomUUID(),
        tenantId: DEFAULT_TENANT_ID,
        email: `${role}@test.local`,
        passwordHash: await hashPassword("irrelevant-but-long-enough"),
        role,
        forcePasswordReset: false,
        disabled: false,
        emailVerifiedAt: now,
        totpSecret: null,
        totpEnabled: false,
        failedLoginCount: 0,
        lockedUntil: null,
        onboardingCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const route of ROUTES) {
      if (route.minRole === "public") continue;
      const minRank = ROLE_RANK[route.minRole];

      for (const role of ["viewer", "operator", "admin"] as Role[]) {
        const { cookie, csrfHeader } = await buildAuthedRequest(app, users[role]);
        const isMutation = route.method !== "GET";
        const res = await hono.request(route.path, {
          method: route.method,
          headers: {
            Cookie: cookie,
            ...(route.body ? { "Content-Type": "application/json" } : {}),
            ...(isMutation ? { "X-CSRF-Token": csrfHeader } : {}),
          },
          body: route.body ? JSON.stringify(route.body) : undefined,
        });

        if (ROLE_RANK[role] < minRank) {
          expect(res.status, `${route.method} ${route.path} as ${role} (below ${route.minRole}) should 403`).toBe(403);
        } else {
          expect([401, 403]).not.toContain(res.status);
        }
      }
    }
  });
});

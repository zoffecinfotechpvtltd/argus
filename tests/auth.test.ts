import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadMigrationsFromDir, runMigrations } from "@adapters/db/sqlite/connection";
import { SqliteUserRepo, SqliteSessionRepo } from "@adapters/db/sqlite/authRepos";
import { FakeClock } from "@adapters/clock";
import { hashPassword } from "@adapters/crypto";
import { createSession, requireAuth, requireRole, SESSION_COOKIE } from "@api/middleware/auth";
import { DEFAULT_TENANT_ID } from "@domain/entities";
import type { AppContainer } from "@bootstrap/container";

function buildTestApp() {
  const db = new Database(":memory:");
  runMigrations(db, loadMigrationsFromDir(join(import.meta.dir, "..", "migrations")));

  const clock = new FakeClock(new Date("2026-01-01T00:00:00Z"));
  const app = {
    clock,
    repos: {
      user: new SqliteUserRepo(db),
      session: new SqliteSessionRepo(db),
    },
  } as unknown as AppContainer;

  const hono = new Hono();
  hono.get("/viewer-only", requireAuth(app), requireRole("viewer"), (c) => c.json({ ok: true }));
  hono.get("/admin-only", requireAuth(app), requireRole("admin"), (c) => c.json({ ok: true }));
  hono.post("/mutate", requireAuth(app), (c) => c.json({ ok: true }));

  return { app, hono, db, clock };
}

async function makeUser(app: AppContainer, role: "admin" | "operator" | "viewer" = "viewer") {
  const now = app.clock.now().toISOString();
  const user = await app.repos.user.create({
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    email: `${role}-${randomUUID()}@test.local`,
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
  return user;
}

describe("requireAuth", () => {
  it("rejects requests with no session cookie", async () => {
    const { hono } = buildTestApp();
    const res = await hono.request("/viewer-only");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown session id", async () => {
    const { hono } = buildTestApp();
    const res = await hono.request("/viewer-only", { headers: { Cookie: `${SESSION_COOKIE}=does-not-exist` } });
    expect(res.status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { app, hono, clock } = buildTestApp();
    const user = await makeUser(app, "viewer");
    const session = await createSession(app, user);
    clock.advance(25 * 60 * 60 * 1000); // past the 24h TTL
    const res = await hono.request("/viewer-only", { headers: { Cookie: `${SESSION_COOKIE}=${session.id}` } });
    expect(res.status).toBe(401);
  });

  it("accepts a valid session for a GET route", async () => {
    const { app, hono } = buildTestApp();
    const user = await makeUser(app, "viewer");
    const session = await createSession(app, user);
    const res = await hono.request("/viewer-only", { headers: { Cookie: `${SESSION_COOKIE}=${session.id}` } });
    expect(res.status).toBe(200);
  });

  it("rejects a mutating request without a matching CSRF token", async () => {
    const { app, hono } = buildTestApp();
    const user = await makeUser(app, "viewer");
    const session = await createSession(app, user);
    const res = await hono.request("/mutate", { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${session.id}` } });
    expect(res.status).toBe(403);
  });

  it("accepts a mutating request with matching double-submit CSRF cookie + header", async () => {
    const { app, hono } = buildTestApp();
    const user = await makeUser(app, "viewer");
    const session = await createSession(app, user);
    const res = await hono.request("/mutate", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${session.id}; np_csrf=abc123`,
        "X-CSRF-Token": "abc123",
      },
    });
    expect(res.status).toBe(200);
  });
});

describe("requireRole", () => {
  it("allows a viewer on a viewer-gated route", async () => {
    const { app, hono } = buildTestApp();
    const user = await makeUser(app, "viewer");
    const session = await createSession(app, user);
    const res = await hono.request("/viewer-only", { headers: { Cookie: `${SESSION_COOKIE}=${session.id}` } });
    expect(res.status).toBe(200);
  });

  it("rejects a viewer on an admin-gated route", async () => {
    const { app, hono } = buildTestApp();
    const user = await makeUser(app, "viewer");
    const session = await createSession(app, user);
    const res = await hono.request("/admin-only", { headers: { Cookie: `${SESSION_COOKIE}=${session.id}` } });
    expect(res.status).toBe(403);
  });

  it("allows an admin on an admin-gated route", async () => {
    const { app, hono } = buildTestApp();
    const user = await makeUser(app, "admin");
    const session = await createSession(app, user);
    const res = await hono.request("/admin-only", { headers: { Cookie: `${SESSION_COOKIE}=${session.id}` } });
    expect(res.status).toBe(200);
  });
});

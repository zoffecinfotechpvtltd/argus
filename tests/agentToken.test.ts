import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { buildServer } from "@api/server";
import { generateAgentToken } from "@api/middleware/agentToken";
import { hashPassword } from "@adapters/crypto";
import { DEFAULT_TENANT_ID } from "@domain/entities";

/** The setup-required gate 503s every route until an admin exists — same seed routeRoleMatrix.test.ts uses. */
async function seedAdmin(app: ReturnType<typeof buildTestContainer>["app"]): Promise<void> {
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
}

describe("requireAgentToken (via POST /api/agent/checks)", () => {
  it("rejects a missing Authorization header", async () => {
    const { app } = buildTestContainer();
    await seedAdmin(app);
    const hono = buildServer(app);
    const res = await hono.request("/api/agent/checks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "x", results: [{ checkId: "x", result: { ok: true } }] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed bearer token", async () => {
    const { app } = buildTestContainer();
    await seedAdmin(app);
    const hono = buildServer(app);
    const res = await hono.request("/api/agent/checks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not-an-agent-token" },
      body: JSON.stringify({ deviceId: "x", results: [{ checkId: "x", result: { ok: true } }] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a well-formed but unknown token", async () => {
    const { app } = buildTestContainer();
    await seedAdmin(app);
    const hono = buildServer(app);
    const { token } = generateAgentToken();
    const res = await hono.request("/api/agent/checks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: "x", results: [{ checkId: "x", result: { ok: true } }] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a revoked agent's token", async () => {
    const { app } = buildTestContainer();
    await seedAdmin(app);
    const hono = buildServer(app);
    const { prefix, token, hash } = generateAgentToken();
    const agent = await app.repos.remoteAgent.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      name: "revoked-agent",
      tokenHash: hash,
      tokenPrefix: prefix,
      createdAt: app.clock.nowIso(),
      lastSeenAt: null,
      revokedAt: null,
    });
    await app.repos.remoteAgent.revoke(DEFAULT_TENANT_ID, agent.id);

    const res = await hono.request("/api/agent/checks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: "x", results: [{ checkId: "x", result: { ok: true } }] }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and reports the ownership error as JSON, not a crash", async () => {
    const { app } = buildTestContainer();
    await seedAdmin(app);
    const hono = buildServer(app);
    const { prefix, token, hash } = generateAgentToken();
    await app.repos.remoteAgent.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      name: "valid-agent",
      tokenHash: hash,
      tokenPrefix: prefix,
      createdAt: app.clock.nowIso(),
      lastSeenAt: null,
      revokedAt: null,
    });

    const res = await hono.request("/api/agent/checks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: "no-such-device", results: [{ checkId: "x", result: { ok: true } }] }),
    });
    // Past auth (not 401) — the request reaches the handler, which reports a clean 404 for the
    // nonexistent device rather than the token itself being the problem.
    expect(res.status).toBe(404);
  });
});

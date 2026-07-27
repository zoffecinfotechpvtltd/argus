import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { buildServer } from "@api/server";
import { createSession, SESSION_COOKIE } from "@api/middleware/auth";
import { hashPassword } from "@adapters/crypto";
import { generatePublicStatusPage, getStatusPageConfig, setStatusPageConfig } from "@application/statusPage";
import { DEFAULT_TENANT_ID, type Device, type Tenant, type User } from "@domain/entities";

async function seedDevice(app: ReturnType<typeof buildTestContainer>["app"], overrides: Partial<Device> = {}): Promise<Device> {
  const now = app.clock.nowIso();
  const device: Device = {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    name: "device",
    ip: "10.0.0.1",
    mac: null,
    vendor: null,
    type: "unknown",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: 60,
    enabled: true,
    snmpCredsEnc: null,
    tags: [],
    uplinkDeviceId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await app.repos.device.create(device);
  return device;
}

// buildTestContainer doesn't lazy-seed the "local" tenant row the way buildSqliteContainer does
// at real boot (see bootstrap/container.ts) — tests that need `tenant.findById` to resolve
// (generatePublicStatusPage does) must create it explicitly.
async function seedTenant(app: ReturnType<typeof buildTestContainer>["app"]): Promise<Tenant> {
  return app.repos.tenant.create({ id: DEFAULT_TENANT_ID, name: "Acme Corp", plan: "enterprise", createdAt: app.clock.nowIso() });
}

async function seedAdmin(app: ReturnType<typeof buildTestContainer>["app"]): Promise<User> {
  const now = app.clock.nowIso();
  return app.repos.user.create({
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    email: "admin@test.local",
    passwordHash: await hashPassword("irrelevant-but-long-enough"),
    role: "admin",
    forcePasswordReset: false,
    disabled: false,
    emailVerifiedAt: now,
    totpSecret: null,
    totpEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("generatePublicStatusPage", () => {
  it("returns null when no config has been saved yet", async () => {
    const { app } = buildTestContainer();
    expect(await generatePublicStatusPage(app, DEFAULT_TENANT_ID)).toBeNull();
  });

  it("returns null when the config exists but is disabled", async () => {
    const { app } = buildTestContainer();
    const device = await seedDevice(app);
    await setStatusPageConfig(app, DEFAULT_TENANT_ID, { enabled: false, title: "", deviceIds: [device.id], groupIds: [] });
    expect(await generatePublicStatusPage(app, DEFAULT_TENANT_ID)).toBeNull();
  });

  it("returns null when enabled but nothing has been opted in", async () => {
    const { app } = buildTestContainer();
    await setStatusPageConfig(app, DEFAULT_TENANT_ID, { enabled: true, title: "", deviceIds: [], groupIds: [] });
    expect(await generatePublicStatusPage(app, DEFAULT_TENANT_ID)).toBeNull();
  });

  it("returns null for a tenant that doesn't exist", async () => {
    const { app } = buildTestContainer();
    expect(await generatePublicStatusPage(app, "no-such-tenant")).toBeNull();
  });

  it("includes only opted-in devices, redacted to name + state, and computes overall state from the worst one", async () => {
    const { app } = buildTestContainer();
    await seedTenant(app);
    const group = await app.repos.group.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      name: "core",
      escalationChain: [],
      createdAt: app.clock.nowIso(),
      updatedAt: app.clock.nowIso(),
    });
    const grouped = await seedDevice(app, { name: "core-switch", ip: "10.0.0.2", groupId: group.id });
    const standalone = await seedDevice(app, { name: "vpn-gw", ip: "10.0.0.3" });
    const excluded = await seedDevice(app, { name: "internal-only", ip: "10.0.0.4" });

    await app.repos.status.upsert({
      deviceId: grouped.id,
      tenantId: DEFAULT_TENANT_ID,
      state: "down",
      since: app.clock.nowIso(),
      lastSeen: app.clock.nowIso(),
      lastLatencyMs: null,
      consecutiveFails: 3,
      consecutiveOk: 0,
      transitionLog: [],
    });

    await setStatusPageConfig(app, DEFAULT_TENANT_ID, {
      enabled: true,
      title: "Acme Status",
      deviceIds: [standalone.id],
      groupIds: [group.id],
    });

    const page = await generatePublicStatusPage(app, DEFAULT_TENANT_ID);
    expect(page).not.toBeNull();
    expect(page!.title).toBe("Acme Status");
    expect(page!.overallState).toBe("outage");
    expect(page!.groups).toEqual([{ id: group.id, name: "core", devices: [{ id: grouped.id, name: "core-switch", state: "down" }] }]);
    expect(page!.ungrouped).toEqual([{ id: standalone.id, name: "vpn-gw", state: "up" }]);
    // Never mentions the excluded device, and never leaks an IP for any included one.
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain(excluded.id);
    expect(serialized).not.toContain("10.0.0.2");
    expect(serialized).not.toContain("10.0.0.3");
  });
});

describe("GET /api/status-page/:tenantSlug", () => {
  it("is reachable with no session at all", async () => {
    const { app } = buildTestContainer();
    await seedTenant(app);
    // Exe mode's setup-required gate (server.ts) blocks every /api/* route until an admin exists —
    // the public status page inherits that gate like everything else (see statusPage.ts's own
    // comment: there's no tenant data worth showing before setup completes anyway), so an admin
    // must exist for this request to reach the route handler at all, even though the request
    // itself carries no session cookie.
    await seedAdmin(app);
    const device = await seedDevice(app);
    await setStatusPageConfig(app, DEFAULT_TENANT_ID, { enabled: true, title: "", deviceIds: [device.id], groupIds: [] });
    const hono = buildServer(app);

    const res = await hono.request(`/api/status-page/${DEFAULT_TENANT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ungrouped: Array<{ name: string }> };
    expect(body.ungrouped[0]?.name).toBe("device");
  });

  it("404s for a disabled/unknown status page without revealing which", async () => {
    const { app } = buildTestContainer();
    await seedTenant(app);
    await seedAdmin(app);
    const hono = buildServer(app);
    const res = await hono.request(`/api/status-page/${DEFAULT_TENANT_ID}`);
    expect(res.status).toBe(404);
    const resUnknown = await hono.request(`/api/status-page/does-not-exist`);
    expect(resUnknown.status).toBe(404);
  });
});

describe("GET/PUT /api/status-page-config", () => {
  it("rejects both without a session", async () => {
    const { app } = buildTestContainer();
    await seedTenant(app);
    await seedAdmin(app); // clears the exe-mode setup-required gate so this actually exercises requireAuth's 401, not the gate's 503
    const hono = buildServer(app);
    expect((await hono.request("/api/status-page-config")).status).toBe(401);
    expect(
      (
        await hono.request("/api/status-page-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true, title: "", deviceIds: [], groupIds: [] }),
        })
      ).status
    ).toBe(401);
  });

  it("lets an admin read and update its own tenant's config", async () => {
    const { app } = buildTestContainer();
    await seedTenant(app);
    const admin = await seedAdmin(app);
    const device = await seedDevice(app);
    const hono = buildServer(app);
    const session = await createSession(app, admin);
    const csrf = "test-csrf-token";
    const cookie = `${SESSION_COOKIE}=${session.id}; np_csrf=${csrf}`;

    const putRes = await hono.request("/api/status-page-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ enabled: true, title: "Acme", deviceIds: [device.id], groupIds: [] }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await hono.request("/api/status-page-config", { headers: { Cookie: cookie } });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ enabled: true, title: "Acme", deviceIds: [device.id], groupIds: [] });

    // And the public route now reflects it, end to end.
    const publicRes = await hono.request(`/api/status-page/${DEFAULT_TENANT_ID}`);
    expect(publicRes.status).toBe(200);
  });
});

describe("getStatusPageConfig", () => {
  it("defaults to disabled with empty selections when nothing has been saved", async () => {
    const { app } = buildTestContainer();
    expect(await getStatusPageConfig(app, DEFAULT_TENANT_ID)).toEqual({ enabled: false, title: "", deviceIds: [], groupIds: [] });
  });
});

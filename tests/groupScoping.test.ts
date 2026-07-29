import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { buildServer } from "@api/server";
import { createSession, SESSION_COOKIE } from "@api/middleware/auth";
import { DEFAULT_TENANT_ID, type Device, type User } from "@domain/entities";

type App = ReturnType<typeof buildTestContainer>["app"];

async function makeUser(app: App, scopedGroupIds: string[] | null): Promise<User> {
  const now = app.clock.nowIso();
  return app.repos.user.create({
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    email: `scoped-${randomUUID()}@test.local`,
    passwordHash: "irrelevant-not-used-by-session-auth",
    role: "admin", // role-ranked above the operator/viewer floor every device route requires, so only group-scoping is under test
    forcePasswordReset: false,
    disabled: false,
    emailVerifiedAt: now,
    totpSecret: null,
    totpEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    onboardingCompletedAt: null,
    scopedGroupIds,
    createdAt: now,
    updatedAt: now,
  });
}

async function makeDevice(app: App, groupId: string | null): Promise<Device> {
  const now = app.clock.nowIso();
  const device: Device = {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    name: `device-${randomUUID()}`,
    ip: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    mac: null,
    vendor: null,
    type: "unknown",
    location: null,
    groupId,
    responsibleUserId: null,
    intervalSec: 60,
    enabled: true,
    snmpCredsEnc: null,
    tags: [],
    uplinkDeviceId: null,
    createdAt: now,
    updatedAt: now,
  };
  await app.repos.device.create(device);
  return device;
}

async function authHeaders(app: App, user: User): Promise<{ Cookie: string; "X-CSRF-Token": string }> {
  const session = await createSession(app, user);
  const csrf = "test-csrf-token";
  return { Cookie: `${SESSION_COOKIE}=${session.id}; np_csrf=${csrf}`, "X-CSRF-Token": csrf };
}

describe("RBAC group-scoping (assertGroupAccess)", () => {
  it("an unscoped user (scopedGroupIds null, the default) can read/update/delete any device", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    const user = await makeUser(app, null);
    const device = await makeDevice(app, "group-a");
    const headers = await authHeaders(app, user);

    const getRes = await hono.request(`/api/devices/${device.id}`, { headers: { Cookie: headers.Cookie } });
    expect(getRes.status).toBe(200);

    const patchRes = await hono.request(`/api/devices/${device.id}`, {
      method: "PATCH",
      headers: { Cookie: headers.Cookie, "X-CSRF-Token": headers["X-CSRF-Token"], "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(patchRes.status).toBe(200);
  });

  it("a scoped user can access a device inside their scoped groups", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    const user = await makeUser(app, ["group-a"]);
    const device = await makeDevice(app, "group-a");
    const headers = await authHeaders(app, user);

    const res = await hono.request(`/api/devices/${device.id}`, { headers: { Cookie: headers.Cookie } });
    expect(res.status).toBe(200);
  });

  it("a scoped user is denied (403) GET/PATCH/DELETE for a device outside their scoped groups", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    const user = await makeUser(app, ["group-a"]);
    const device = await makeDevice(app, "group-b");
    const headers = await authHeaders(app, user);

    const getRes = await hono.request(`/api/devices/${device.id}`, { headers: { Cookie: headers.Cookie } });
    expect(getRes.status).toBe(403);

    const patchRes = await hono.request(`/api/devices/${device.id}`, {
      method: "PATCH",
      headers: { Cookie: headers.Cookie, "X-CSRF-Token": headers["X-CSRF-Token"], "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(patchRes.status).toBe(403);

    const deleteRes = await hono.request(`/api/devices/${device.id}`, {
      method: "DELETE",
      headers: { Cookie: headers.Cookie, "X-CSRF-Token": headers["X-CSRF-Token"] },
    });
    expect(deleteRes.status).toBe(403);
  });

  it("a scoped user is denied access to an ungrouped device (groupId null)", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    const user = await makeUser(app, ["group-a"]);
    const device = await makeDevice(app, null);
    const headers = await authHeaders(app, user);

    const res = await hono.request(`/api/devices/${device.id}`, { headers: { Cookie: headers.Cookie } });
    expect(res.status).toBe(403);
  });

  it("a scoped user still gets a plain 404 (not 403) for a device that doesn't exist", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    const user = await makeUser(app, ["group-a"]);
    const headers = await authHeaders(app, user);

    const res = await hono.request(`/api/devices/${randomUUID()}`, { headers: { Cookie: headers.Cookie } });
    expect(res.status).toBe(404);
  });

  it("SqliteUserRepo round-trips scopedGroupIds through create/findById/update", async () => {
    const { app } = buildTestContainer();
    const now = app.clock.nowIso();
    const created = await app.repos.user.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      email: `roundtrip-${randomUUID()}@test.local`,
      passwordHash: "x",
      role: "viewer",
      forcePasswordReset: false,
      disabled: false,
      emailVerifiedAt: null,
      totpSecret: null,
      totpEnabled: false,
      failedLoginCount: 0,
      lockedUntil: null,
      onboardingCompletedAt: null,
      scopedGroupIds: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(created.scopedGroupIds).toBeNull();

    const fetched = await app.repos.user.findById(DEFAULT_TENANT_ID, created.id);
    expect(fetched?.scopedGroupIds).toBeNull();

    const updated = await app.repos.user.update(DEFAULT_TENANT_ID, created.id, { scopedGroupIds: ["group-a", "group-b"] });
    expect(updated?.scopedGroupIds).toEqual(["group-a", "group-b"]);
  });
});

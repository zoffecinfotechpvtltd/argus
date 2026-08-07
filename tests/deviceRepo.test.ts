import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadMigrationsFromDir, runMigrations } from "@adapters/db/sqlite/connection";
import { SqliteDeviceRepo } from "@adapters/db/sqlite/deviceRepos";
import { SqliteUserRepo } from "@adapters/db/sqlite/authRepos";
import { DEFAULT_TENANT_ID, type Device, type User } from "@domain/entities";

function freshDb(): Database {
  const db = new Database(":memory:");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  runMigrations(db, loadMigrationsFromDir(migrationsDir));
  return db;
}

describe("SqliteDeviceRepo", () => {
  it("round-trips create → findById → update → delete", async () => {
    const db = freshDb();
    const repo = new SqliteDeviceRepo(db);
    const now = new Date().toISOString();

    const device: Device = {
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      name: "core-switch-1",
      ip: "192.168.1.1",
      mac: "AA:BB:CC:DD:EE:FF",
      vendor: "Cisco",
      type: "switch",
      location: "Server Room",
      groupId: null,
      responsibleUserId: null,
      intervalSec: 60,
      enabled: true,
      snmpCredsEnc: null,
      tags: [],
      uplinkDeviceId: null,
      criticalAsset: false,
      model: null,
      firmwareVersion: null,
      serialNumber: null,
      haRole: null,
      apiVendor: null,
      apiCredsEnc: null,
      remoteAgentId: null,
      createdAt: now,
      updatedAt: now,
    };

    await repo.create(device);

    const found = await repo.findById(DEFAULT_TENANT_ID, device.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("core-switch-1");
    expect(found?.ip).toBe("192.168.1.1");

    const byIp = await repo.findByIp(DEFAULT_TENANT_ID, "192.168.1.1");
    expect(byIp?.id).toBe(device.id);

    const updated = await repo.update(DEFAULT_TENANT_ID, device.id, { name: "core-switch-1-renamed" });
    expect(updated?.name).toBe("core-switch-1-renamed");

    const page = await repo.list(DEFAULT_TENANT_ID, {});
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(device.id);

    const deleted = await repo.delete(DEFAULT_TENANT_ID, device.id);
    expect(deleted).toBe(true);
    expect(await repo.findById(DEFAULT_TENANT_ID, device.id)).toBeNull();

    db.close();
  });

  it("scopes queries by tenant_id", async () => {
    const db = freshDb();
    const repo = new SqliteDeviceRepo(db);
    const now = new Date().toISOString();

    const makeDevice = (tenantId: string, ip: string): Device => ({
      id: randomUUID(),
      tenantId,
      name: `device-${tenantId}`,
      ip,
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
      criticalAsset: false,
      model: null,
      firmwareVersion: null,
      serialNumber: null,
      haRole: null,
      apiVendor: null,
      apiCredsEnc: null,
      remoteAgentId: null,
      createdAt: now,
      updatedAt: now,
    });

    await repo.create(makeDevice("tenant-a", "10.0.0.1"));
    await repo.create(makeDevice("tenant-b", "10.0.0.1")); // same IP, different tenant — must not collide

    const pageA = await repo.list("tenant-a", {});
    const pageB = await repo.list("tenant-b", {});
    expect(pageA.total).toBe(1);
    expect(pageB.total).toBe(1);
    expect(pageA.items[0]?.tenantId).toBe("tenant-a");

    db.close();
  });
});

describe("SqliteUserRepo", () => {
  it("finds users case-insensitively by email and counts all users", async () => {
    const db = freshDb();
    const repo = new SqliteUserRepo(db);
    const now = new Date().toISOString();

    expect(await repo.countAll()).toBe(0);

    const user: User = {
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      email: "Admin@Example.com",
      passwordHash: "hash",
      role: "admin",
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
    };
    await repo.create(user);

    expect(await repo.countAll()).toBe(1);
    const found = await repo.findByEmail(DEFAULT_TENANT_ID, "admin@example.com");
    expect(found?.id).toBe(user.id);

    db.close();
  });
});

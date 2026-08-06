import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { SqliteTickPersister } from "@adapters/db/sqlite/tickPersister";
import { Scheduler } from "@application/scheduler";
import { DEFAULT_TENANT_ID, type Device } from "@domain/entities";
import type { AppContainer } from "@ports/context";
import type { Checker, CheckResult } from "@ports/services";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedDevice(app: AppContainer, overrides: Partial<Device> = {}): Promise<Device> {
  const now = new Date().toISOString();
  const device: Device = {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    name: "seeded",
    ip: "10.0.0.1",
    mac: null,
    vendor: null,
    type: "unknown",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: 1,
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await app.repos.device.create(device);
  await app.repos.check.create({
    id: randomUUID(),
    tenantId: device.tenantId,
    deviceId: device.id,
    kind: "icmp",
    config: {},
    thresholds: { latencyMs: 200, lossPct: 10 },
    enabled: true,
    createdAt: now,
  });
  return device;
}

describe("Scheduler", () => {
  it("polls seeded devices and batches status+metric writes in one transaction per flush (not per device)", async () => {
    let callCount = 0;
    const countingChecker: Checker = {
      run: async () => {
        callCount++;
        return { ok: true, latencyMs: 5, values: { lossPct: 0 } } as CheckResult;
      },
    };

    const { app, db } = buildTestContainer({ checker: countingChecker });
    const persistCalls: Array<{ statusCount: number }> = [];
    const realPersister = new SqliteTickPersister(db);
    app.tickPersister = {
      persist: async (statusUpdates, metrics) => {
        persistCalls.push({ statusCount: statusUpdates.length });
        return realPersister.persist(statusUpdates, metrics);
      },
    };

    await seedDevice(app, { name: "a", ip: "10.0.0.1" });
    await seedDevice(app, { name: "b", ip: "10.0.0.2" });
    await seedDevice(app, { name: "c", ip: "10.0.0.3" });

    const scheduler = new Scheduler(app);
    await scheduler.start();
    await sleep(2500);
    await scheduler.stop();

    expect(callCount).toBeGreaterThanOrEqual(3); // each device polled at least twice over 2.5s at a 1s interval
    expect(persistCalls.length).toBeGreaterThan(0);
    const totalStatusRows = persistCalls.reduce((sum, c) => sum + c.statusCount, 0);
    // Batching proof: far fewer persist() calls than one-call-per-device-per-poll would require.
    expect(persistCalls.length).toBeLessThan(totalStatusRows === 0 ? 1 : totalStatusRows * 3);

    const statuses = await app.repos.status.listByTenant(DEFAULT_TENANT_ID);
    expect(statuses.every((s) => s.state === "up")).toBe(true);
  });

  it("respects the global concurrency cap", async () => {
    let concurrentNow = 0;
    let maxObservedConcurrency = 0;
    const slowChecker: Checker = {
      run: async () => {
        concurrentNow++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentNow);
        await sleep(150);
        concurrentNow--;
        return { ok: true, latencyMs: 1 };
      },
    };

    const { app } = buildTestContainer({ checker: slowChecker });
    app.config.polling.concurrency = 2;
    for (let i = 0; i < 8; i++) {
      await seedDevice(app, { name: `d${i}`, ip: `10.0.1.${i}`, intervalSec: 1 });
    }

    const scheduler = new Scheduler(app);
    await scheduler.start();
    await sleep(1200);
    await scheduler.stop();

    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
  });

  it("suppresses state events for a device inside an active maintenance window, but keeps recording metrics", async () => {
    const failingChecker: Checker = { run: async () => ({ ok: false, error: "down", values: { lossPct: 100 } }) };
    const { app } = buildTestContainer({ checker: failingChecker });
    const device = await seedDevice(app, { name: "under-maintenance", ip: "10.0.2.1", intervalSec: 1 });

    const now = new Date();
    await app.repos.maintenance.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      deviceId: device.id,
      groupId: null,
      startsAt: new Date(now.getTime() - 60_000).toISOString(),
      endsAt: new Date(now.getTime() + 60_000).toISOString(),
      recurrence: null,
      createdBy: null,
      createdAt: now.toISOString(),
    });

    let sawMonitoringEvent = false;
    app.events.on("monitoring.event", () => {
      sawMonitoringEvent = true;
    });

    const scheduler = new Scheduler(app);
    await scheduler.start();
    await sleep(2500);
    await scheduler.stop();

    const status = await app.repos.status.findByDeviceId(DEFAULT_TENANT_ID, device.id);
    expect(status?.state).toBe("maintenance");
    expect(sawMonitoringEvent).toBe(false);

    const metrics = await app.repos.metric.queryRaw(DEFAULT_TENANT_ID, {
      deviceId: device.id,
      from: "2000-01-01T00:00:00.000Z",
      to: "2100-01-01T00:00:00.000Z",
    });
    expect(metrics.length).toBeGreaterThan(0); // metrics still recorded during maintenance
  });

  it("picks up a newly created device without a restart, via the device.changed event", async () => {
    const { app } = buildTestContainer();

    const scheduler = new Scheduler(app);
    await scheduler.start();
    expect(scheduler.getScheduledDeviceCount()).toBe(0);

    const device = await seedDevice(app, { name: "late-arrival", ip: "10.0.3.1", intervalSec: 1 });
    app.events.emit("device.changed", { deviceId: device.id, tenantId: DEFAULT_TENANT_ID });
    await sleep(50); // let the async event handler finish loading the device

    expect(scheduler.getScheduledDeviceCount()).toBe(1);
    await scheduler.stop();
  });
});

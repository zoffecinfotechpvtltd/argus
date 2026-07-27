import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { generateSlaReport } from "@application/reports";
import { DEFAULT_TENANT_ID, type Device } from "@domain/entities";

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

describe("generateSlaReport (integration)", () => {
  it("reports 100% availability for a device with no recorded downtime", async () => {
    const { app } = buildTestContainer();
    const device = await seedDevice(app, { name: "always-up" });

    const rows = await generateSlaReport(app, DEFAULT_TENANT_ID, {
      fromIso: "2026-01-01T00:00:00.000Z",
      toIso: "2026-01-02T00:00:00.000Z",
    });

    expect(rows).toEqual([{ deviceId: device.id, deviceName: "always-up", availabilityPct: 100, downMs: 0 }]);
  });

  it("matches the hand-computed fixture (36 min down in 24h = 97.5%) end-to-end through the history repo", async () => {
    const { app, db } = buildTestContainer();
    const device = await seedDevice(app, { name: "flaky" });

    // Directly seed a closed 36-minute down interval in device_state_history, as the TickPersister would.
    db.query(
      `INSERT INTO device_state_history (tenant_id, device_id, state, started_at, ended_at) VALUES ($tenant_id,$device_id,'down',$start,$end)`
    ).run({
      $tenant_id: DEFAULT_TENANT_ID,
      $device_id: device.id,
      $start: "2026-01-01T10:00:00.000Z",
      $end: "2026-01-01T10:36:00.000Z",
    });

    const rows = await generateSlaReport(app, DEFAULT_TENANT_ID, {
      fromIso: "2026-01-01T00:00:00.000Z",
      toIso: "2026-01-02T00:00:00.000Z",
    });

    expect(rows[0]?.availabilityPct).toBe(97.5);
    expect(rows[0]?.downMs).toBe(36 * 60 * 1000);
  });

  it("scopes the report to a single group", async () => {
    const { app } = buildTestContainer();
    const group = await app.repos.group.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      name: "core",
      escalationChain: [],
      createdAt: app.clock.nowIso(),
      updatedAt: app.clock.nowIso(),
    });
    await seedDevice(app, { name: "in-group", ip: "10.0.0.2", groupId: group.id });
    await seedDevice(app, { name: "no-group", ip: "10.0.0.3" });

    const rows = await generateSlaReport(app, DEFAULT_TENANT_ID, {
      groupId: group.id,
      fromIso: "2026-01-01T00:00:00.000Z",
      toIso: "2026-01-02T00:00:00.000Z",
    });

    expect(rows.length).toBe(1);
    expect(rows[0]?.deviceName).toBe("in-group");
  });
});

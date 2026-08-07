import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { reclassifyDevices } from "@application/reclassification";
import { encryptSecret } from "@adapters/crypto";
import { serializeSnmpCredential } from "@domain/snmpCredential";
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
  return device;
}

describe("reclassifyDevices", () => {
  it("never touches a device that already has a specific type, even with SNMP configured", async () => {
    const { app } = buildTestContainer();
    const snmpCredsEnc = encryptSecret(app.instanceKey, serializeSnmpCredential({ version: "2c", community: "public" }));
    const device = await seedDevice(app, { type: "server", snmpCredsEnc, ip: "127.0.0.1" });

    const result = await reclassifyDevices(app);

    expect(result.checked).toBe(0); // filtered out before ever attempting a probe
    const after = await app.repos.device.findById(DEFAULT_TENANT_ID, device.id);
    expect(after?.type).toBe("server"); // untouched
  });

  it("skips devices with no SNMP credentials configured", async () => {
    const { app } = buildTestContainer();
    await seedDevice(app, { type: "unknown", snmpCredsEnc: null });

    const result = await reclassifyDevices(app);

    expect(result.checked).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("counts an unknown-type SNMP device as checked but doesn't update it when the probe gets no response", async () => {
    const { app } = buildTestContainer();
    // Port 1 is never a real SNMP agent — probeSnmp resolves null on any failure rather than
    // throwing, so this exercises the "checked but not updated" path without a live SNMP server.
    const snmpCredsEnc = encryptSecret(app.instanceKey, serializeSnmpCredential({ version: "2c", community: "public" }));
    const device = await seedDevice(app, { type: "unknown", snmpCredsEnc, ip: "127.0.0.1" });

    const result = await reclassifyDevices(app);

    expect(result.checked).toBe(1);
    expect(result.updated).toBe(0);
    const after = await app.repos.device.findById(DEFAULT_TENANT_ID, device.id);
    expect(after?.type).toBe("unknown"); // no signal, no change
  });
});

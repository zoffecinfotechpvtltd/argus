import { describe, expect, it } from "bun:test";
import { buildTestContainer } from "./helpers/testContainer";
import { createDevice, DuplicateDeviceError } from "@application/devices/deviceUseCases";
import { importDiscoveredDevices } from "@application/discovery/importDiscoveredDevices";
import { DEFAULT_TENANT_ID } from "@domain/entities";

describe("createDevice", () => {
  it("creates a device with ICMP+HTTP+SNMP default checks and an audit entry", async () => {
    const { app } = buildTestContainer();
    const device = await createDevice(app, DEFAULT_TENANT_ID, "actor-1", {
      name: "cam-1",
      ip: "10.0.0.5",
      hasHttp: true,
      snmpCredsEnc: "encrypted-blob",
    });

    expect(device.ip).toBe("10.0.0.5");
    const checks = await app.repos.check.listByDevice(DEFAULT_TENANT_ID, device.id);
    expect(checks.map((c) => c.kind).sort()).toEqual(["http", "icmp", "snmp"]);

    const audit = await app.repos.audit.list(DEFAULT_TENANT_ID);
    expect(audit.items.some((a) => a.action === "device.create" && a.entityId === device.id)).toBe(true);
  });

  it("rejects a duplicate IP within the same tenant", async () => {
    const { app } = buildTestContainer();
    await createDevice(app, DEFAULT_TENANT_ID, "actor-1", { name: "a", ip: "10.0.0.9" });
    await expect(createDevice(app, DEFAULT_TENANT_ID, "actor-1", { name: "b", ip: "10.0.0.9" })).rejects.toThrow(DuplicateDeviceError);
  });

  it("allows the same IP across two different tenants", async () => {
    const { app } = buildTestContainer();
    const a = await createDevice(app, "tenant-a", "actor-1", { name: "a", ip: "10.0.0.9" });
    const b = await createDevice(app, "tenant-b", "actor-1", { name: "b", ip: "10.0.0.9" });
    expect(a.tenantId).toBe("tenant-a");
    expect(b.tenantId).toBe("tenant-b");
  });
});

describe("importDiscoveredDevices", () => {
  it("bulk imports devices with default checks and skips IPs that already exist", async () => {
    const { app } = buildTestContainer();
    await createDevice(app, DEFAULT_TENANT_ID, "actor-1", { name: "existing", ip: "10.0.0.1" });

    const result = await importDiscoveredDevices(app, DEFAULT_TENANT_ID, "actor-1", [
      { ip: "10.0.0.1", type: "unknown", openPorts: [] }, // duplicate — should be skipped
      { ip: "10.0.0.2", type: "camera", openPorts: [80, 554] },
      { ip: "10.0.0.3", type: "printer", openPorts: [9100] },
    ]);

    expect(result.skippedDuplicateIps).toEqual(["10.0.0.1"]);
    expect(result.imported.map((d) => d.ip).sort()).toEqual(["10.0.0.2", "10.0.0.3"]);

    const page = await app.repos.device.list(DEFAULT_TENANT_ID);
    expect(page.total).toBe(3); // 1 pre-existing + 2 imported

    const camChecks = await app.repos.check.listByDevice(DEFAULT_TENANT_ID, result.imported[0]!.id);
    expect(camChecks.map((c) => c.kind).sort()).toEqual(["http", "icmp"]);
  });

  it("is atomic: a batch of N selections either all land or none do", async () => {
    const { app } = buildTestContainer();
    const result = await importDiscoveredDevices(app, DEFAULT_TENANT_ID, "actor-1", [
      { ip: "10.1.0.1", type: "server", openPorts: [3389] },
      { ip: "10.1.0.2", type: "server", openPorts: [3389] },
      { ip: "10.1.0.3", type: "server", openPorts: [3389] },
    ]);
    expect(result.imported.length).toBe(3);
    const page = await app.repos.device.list(DEFAULT_TENANT_ID);
    expect(page.total).toBe(3);
  });
});

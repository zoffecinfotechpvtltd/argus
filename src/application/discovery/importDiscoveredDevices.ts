import { randomUUID } from "node:crypto";
import type { AppContainer } from "@ports/context";
import type { Device, DeviceType } from "@domain/entities";
import { buildDefaultChecks } from "@domain/defaultChecks";
import type { DeviceWithChecks } from "@ports/repos";
import { assertLicenseAllowsNewDevice } from "@application/license";

export interface ImportSelection {
  ip: string;
  mac?: string | null;
  vendor?: string | null;
  type: DeviceType;
  openPorts: number[];
  name?: string;
  groupId?: string | null;
  responsibleUserId?: string | null;
  intervalSec?: number;
  /** Already-encrypted SNMP community (encryption happens at the API layer, never in application/domain). */
  snmpCredsEnc?: string | null;
}

export interface ImportResult {
  imported: Device[];
  skippedDuplicateIps: string[];
}

/** Bulk-imports discovered devices, skipping IPs already present for the tenant, creating sane default checks for each. */
export async function importDiscoveredDevices(
  app: AppContainer,
  tenantId: string,
  actorUserId: string,
  selections: ImportSelection[]
): Promise<ImportResult> {
  const now = app.clock.nowIso();
  const toInsert: DeviceWithChecks[] = [];
  const skippedDuplicateIps: string[] = [];

  for (const sel of selections) {
    const existing = await app.repos.device.findByIp(tenantId, sel.ip);
    if (existing) {
      skippedDuplicateIps.push(sel.ip);
      continue;
    }

    const deviceId = randomUUID();
    const device: Device = {
      id: deviceId,
      tenantId,
      name: sel.name?.trim() || sel.vendor || sel.ip,
      ip: sel.ip,
      mac: sel.mac ?? null,
      vendor: sel.vendor ?? null,
      type: sel.type,
      location: null,
      groupId: sel.groupId ?? null,
      responsibleUserId: sel.responsibleUserId ?? null,
      intervalSec: sel.intervalSec ?? app.config.polling.defaultIntervalSec,
      enabled: true,
      snmpCredsEnc: sel.snmpCredsEnc ?? null,
      tags: [],
      uplinkDeviceId: null,
      createdAt: now,
      updatedAt: now,
    };

    const checks = buildDefaultChecks({
      tenantId,
      deviceId,
      hasHttp: sel.openPorts.includes(80),
      hasHttps: sel.openPorts.includes(443),
      hasSnmp: !!sel.snmpCredsEnc,
      nowIso: now,
    });

    toInsert.push({ device, checks });
  }

  if (toInsert.length > 0) {
    await assertLicenseAllowsNewDevice(app, tenantId, toInsert.length);
  }

  const imported = toInsert.length > 0 ? await app.repos.device.createBatchWithChecks(toInsert) : [];

  for (const device of imported) {
    await app.repos.audit.record({
      tenantId,
      userId: actorUserId,
      action: "device.import",
      entityType: "device",
      entityId: device.id,
      detail: { ip: device.ip, type: device.type, source: "discovery" },
      createdAt: now,
    });
    app.events.emit("device.changed", { deviceId: device.id, tenantId });
  }

  return { imported, skippedDuplicateIps };
}

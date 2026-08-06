import { randomUUID } from "node:crypto";
import type { AppContainer } from "@ports/context";
import type { Device, DeviceType } from "@domain/entities";
import { buildDefaultChecks } from "@domain/defaultChecks";
import { assertLicenseAllowsNewDevice } from "@application/license";

export interface CreateDeviceInput {
  name: string;
  ip: string;
  mac?: string | null;
  vendor?: string | null;
  type?: DeviceType;
  location?: string | null;
  groupId?: string | null;
  responsibleUserId?: string | null;
  intervalSec?: number;
  hasHttp?: boolean;
  hasHttps?: boolean;
  /** Already-encrypted at the API layer. */
  snmpCredsEnc?: string | null;
  tags?: string[];
  uplinkDeviceId?: string | null;
  criticalAsset?: boolean;
  apiVendor?: "fortigate" | null;
  /** Already-encrypted at the API layer. */
  apiCredsEnc?: string | null;
}

/** Device types whose downtime is inherently high-stakes regardless of what else is happening on
 * the network — default them to critical (instant page, no storm/rate-limit buffering) unless the
 * caller explicitly overrides it. */
export const DEFAULT_CRITICAL_TYPES: ReadonlySet<DeviceType> = new Set(["camera", "firewall"]);

export async function createDevice(app: AppContainer, tenantId: string, actorUserId: string, input: CreateDeviceInput): Promise<Device> {
  const existing = await app.repos.device.findByIp(tenantId, input.ip);
  if (existing) throw new DuplicateDeviceError(input.ip);

  await assertLicenseAllowsNewDevice(app, tenantId);

  const now = app.clock.nowIso();
  const deviceId = randomUUID();
  const type = input.type ?? "unknown";
  const device: Device = {
    id: deviceId,
    tenantId,
    name: input.name,
    ip: input.ip,
    mac: input.mac ?? null,
    vendor: input.vendor ?? null,
    type,
    location: input.location ?? null,
    groupId: input.groupId ?? null,
    responsibleUserId: input.responsibleUserId ?? null,
    intervalSec: input.intervalSec ?? app.config.polling.defaultIntervalSec,
    enabled: true,
    snmpCredsEnc: input.snmpCredsEnc ?? null,
    tags: input.tags ?? [],
    uplinkDeviceId: input.uplinkDeviceId ?? null,
    criticalAsset: input.criticalAsset ?? DEFAULT_CRITICAL_TYPES.has(type),
    model: null,
    firmwareVersion: null,
    serialNumber: null,
    haRole: null,
    apiVendor: input.apiVendor ?? null,
    apiCredsEnc: input.apiCredsEnc ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const checks = buildDefaultChecks({
    tenantId,
    deviceId,
    hasHttp: !!input.hasHttp,
    hasHttps: !!input.hasHttps,
    hasSnmp: !!input.snmpCredsEnc,
    hasVendorApi: !!input.apiCredsEnc,
    nowIso: now,
  });

  const [created] = await app.repos.device.createBatchWithChecks([{ device, checks }]);

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "device.create",
    entityType: "device",
    entityId: device.id,
    detail: { ip: device.ip, name: device.name },
    createdAt: now,
  });

  app.events.emit("device.changed", { deviceId: device.id, tenantId });

  return created!;
}

export class DuplicateDeviceError extends Error {
  constructor(ip: string) {
    super(`A device with IP ${ip} already exists for this tenant`);
    this.name = "DuplicateDeviceError";
  }
}

export interface UpdateDeviceInput {
  name?: string;
  mac?: string | null;
  vendor?: string | null;
  type?: DeviceType;
  location?: string | null;
  groupId?: string | null;
  responsibleUserId?: string | null;
  intervalSec?: number;
  enabled?: boolean;
  snmpCredsEnc?: string | null;
  tags?: string[];
  uplinkDeviceId?: string | null;
  criticalAsset?: boolean;
  apiVendor?: "fortigate" | null;
  apiCredsEnc?: string | null;
}

export async function updateDevice(
  app: AppContainer,
  tenantId: string,
  actorUserId: string,
  deviceId: string,
  patch: UpdateDeviceInput
): Promise<Device | null> {
  const updated = await app.repos.device.update(tenantId, deviceId, patch);
  if (!updated) return null;

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "device.update",
    entityType: "device",
    entityId: deviceId,
    detail: { patch: Object.keys(patch) },
    createdAt: app.clock.nowIso(),
  });

  app.events.emit("device.changed", { deviceId, tenantId });

  return updated;
}

export async function deleteDevice(app: AppContainer, tenantId: string, actorUserId: string, deviceId: string): Promise<boolean> {
  const deleted = await app.repos.device.delete(tenantId, deviceId);
  if (deleted) {
    await app.repos.audit.record({
      tenantId,
      userId: actorUserId,
      action: "device.delete",
      entityType: "device",
      entityId: deviceId,
      detail: null,
      createdAt: app.clock.nowIso(),
    });
    app.events.emit("device.changed", { deviceId, tenantId, deleted: true });
  }
  return deleted;
}

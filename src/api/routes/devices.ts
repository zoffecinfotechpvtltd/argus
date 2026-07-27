import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { assertGroupAccess, requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { requireAuthOrApiKey } from "@api/middleware/apiKey";
import { validateJson, validateQuery, getValidated, getValidatedQuery } from "@api/middleware/validate";
import { createDevice, deleteDevice, DuplicateDeviceError, updateDevice } from "@application/devices/deviceUseCases";
import { LicenseLimitError } from "@application/license";
import { encryptSecret } from "@adapters/crypto";
import type { AppEnv } from "@api/honoTypes";

const DeviceTypeEnum = z.enum(["camera", "firewall", "switch", "router", "server", "workstation", "printer", "access_point", "nas", "iot", "unknown"]);

const CreateDeviceSchema = z.object({
  name: z.string().min(1).max(200),
  ip: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, "Must be a valid IPv4 address"),
  mac: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  type: DeviceTypeEnum.optional(),
  location: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  intervalSec: z.number().int().min(10).max(86400).optional(),
  hasHttp: z.boolean().optional(),
  hasHttps: z.boolean().optional(),
  snmpCommunity: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  uplinkDeviceId: z.string().nullable().optional(),
});

const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mac: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  type: DeviceTypeEnum.optional(),
  location: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  intervalSec: z.number().int().min(10).max(86400).optional(),
  enabled: z.boolean().optional(),
  snmpCommunity: z.string().min(1).max(200).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  uplinkDeviceId: z.string().nullable().optional(),
});

const ListDevicesQuerySchema = z.object({
  groupId: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  enabled: z.enum(["true", "false"]).optional(),
  withStatus: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function deviceRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/devices", requireAuthOrApiKey(app), requireRole("viewer"), validateQuery(ListDevicesQuerySchema), async (c) => {
    const tenantId = tenantOf(c);
    const q = getValidatedQuery<typeof ListDevicesQuerySchema>(c);
    const filter = {
      groupId: q.groupId,
      type: q.type,
      search: q.search,
      enabled: q.enabled === undefined ? undefined : q.enabled === "true",
      limit: q.limit,
      offset: q.offset,
    };
    const page = q.withStatus === "true" ? await app.repos.device.listWithStatus(tenantId, filter) : await app.repos.device.list(tenantId, filter);
    return c.json(page);
  });

  // RBAC group-scoping (M7): assertGroupAccess denies a scoped user (User.scopedGroupIds non-null)
  // access to a device outside their groups. Unscoped users (the default) are unaffected. Wired here
  // and on the PATCH/DELETE single-device routes below — the same check should extend to other
  // device-scoped routes (checks, metrics, alerts, ...) eventually, but that's a separate change.
  router.get("/devices/:id", requireAuthOrApiKey(app), requireRole("viewer"), assertGroupAccess(app), async (c) => {
    const device = await app.repos.device.findById(tenantOf(c), c.req.param("id")!);
    if (!device) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(device);
  });

  router.post("/devices", requireAuth(app), requireRole("operator"), validateJson(CreateDeviceSchema), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const body = getValidated<typeof CreateDeviceSchema>(c);
    try {
      const device = await createDevice(app, tenantId, user.id, {
        ...body,
        snmpCredsEnc: body.snmpCommunity ? encryptSecret(app.instanceKey, body.snmpCommunity) : null,
      });
      return c.json(device, 201);
    } catch (err) {
      if (err instanceof DuplicateDeviceError) return c.json({ error: "DUPLICATE_IP", message: err.message }, 409);
      if (err instanceof LicenseLimitError) return c.json({ error: "LICENSE_LIMIT_EXCEEDED", message: err.message }, 402);
      throw err;
    }
  });

  router.patch("/devices/:id", requireAuth(app), requireRole("operator"), assertGroupAccess(app), validateJson(UpdateDeviceSchema), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const body = getValidated<typeof UpdateDeviceSchema>(c);
    const { snmpCommunity, ...rest } = body;
    const patch = {
      ...rest,
      ...(snmpCommunity !== undefined
        ? { snmpCredsEnc: snmpCommunity === null ? null : encryptSecret(app.instanceKey, snmpCommunity) }
        : {}),
    };
    const device = await updateDevice(app, tenantId, user.id, c.req.param("id")!, patch);
    if (!device) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(device);
  });

  router.delete("/devices/:id", requireAuth(app), requireRole("operator"), assertGroupAccess(app), async (c) => {
    const user = c.get("user");
    const ok = await deleteDevice(app, tenantOf(c), user.id, c.req.param("id")!);
    if (!ok) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });

  return router;
}

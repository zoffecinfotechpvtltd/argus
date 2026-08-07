import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { assertGroupAccess, requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { requireAuthOrApiKey } from "@api/middleware/apiKey";
import { validateJson, validateQuery, getValidated, getValidatedQuery } from "@api/middleware/validate";
import { createDevice, deleteDevice, DuplicateDeviceError, updateDevice } from "@application/devices/deviceUseCases";
import { LicenseLimitError } from "@application/license";
import { encryptSecret, decryptSecret } from "@adapters/crypto";
import { discoverSnmpInterfaces } from "@adapters/net/snmpMetrics";
import { serializeSnmpCredential, parseSnmpCredential } from "@domain/snmpCredential";
import { serializeVendorApiCredential, serializeSophosApiCredential } from "@domain/vendorApiCredential";
import type { AppEnv } from "@api/honoTypes";

const DeviceTypeEnum = z.enum(["camera", "firewall", "switch", "router", "server", "workstation", "printer", "access_point", "nas", "iot", "unknown"]);

/** SNMPv3 credentials, provided instead of (never alongside) snmpCommunity. authKey/privKey are
 * required only at the security levels that actually use them (enforced in buildSnmpCredsEnc,
 * not here, since that check depends on securityLevel — awkward to express as a single zod shape). */
const SnmpV3Schema = z.object({
  username: z.string().min(1).max(200),
  securityLevel: z.enum(["noAuthNoPriv", "authNoPriv", "authPriv"]),
  authProtocol: z.enum(["md5", "sha", "sha256"]).optional(),
  authKey: z.string().min(8).max(200).optional(),
  privProtocol: z.enum(["des", "aes"]).optional(),
  privKey: z.string().min(8).max(200).optional(),
});

/** Builds the encrypted snmp_creds_enc blob from either legacy snmpCommunity (v2c) or the new
 * snmpV3 object — never both; snmpV3 wins if somehow both are sent. Returns undefined (meaning
 * "no change") when neither is present, so callers can spread the result without clobbering an
 * existing credential on an update that isn't touching SNMP at all. */
function buildSnmpCredsEnc(
  app: AppContainer,
  body: { snmpCommunity?: string | null; snmpVersion?: "1" | "2c"; snmpV3?: z.infer<typeof SnmpV3Schema> }
): string | null | undefined {
  if (body.snmpV3) {
    if (body.snmpV3.securityLevel !== "noAuthNoPriv" && !body.snmpV3.authKey) {
      throw new InvalidSnmpV3Error("authKey is required for authNoPriv/authPriv security levels");
    }
    if (body.snmpV3.securityLevel === "authPriv" && !body.snmpV3.privKey) {
      throw new InvalidSnmpV3Error("privKey is required for the authPriv security level");
    }
    return encryptSecret(app.instanceKey, serializeSnmpCredential({ version: "3", ...body.snmpV3 }));
  }
  if (body.snmpCommunity === null) return null; // explicit clear
  if (body.snmpCommunity) {
    return encryptSecret(app.instanceKey, serializeSnmpCredential({ version: body.snmpVersion ?? "2c", community: body.snmpCommunity }));
  }
  return undefined; // untouched
}

class InvalidSnmpV3Error extends Error {}

/** Discriminated on `vendor` — a device's *type* (firewall) and *which vendor REST API* it exposes
 * are independent facts (a device could be type=firewall with no API configured at all), and each
 * vendor's credential shape is different (FortiGate: a bearer token; Sophos: username+password for
 * its per-request XML login). */
const VendorApiSchema = z.discriminatedUnion("vendor", [
  z.object({
    vendor: z.literal("fortigate"),
    apiToken: z.string().min(1).max(500),
    port: z.number().int().min(1).max(65535).optional(),
    verifyTls: z.boolean().optional(),
  }),
  z.object({
    vendor: z.literal("sophos"),
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(500),
    port: z.number().int().min(1).max(65535).optional(),
    verifyTls: z.boolean().optional(),
  }),
]);

/** Mirrors buildSnmpCredsEnc: returns undefined ("no change") when vendorApi isn't present, so
 * an update that isn't touching the vendor API doesn't clobber an existing apiCredsEnc. */
function buildApiCredsEnc(
  app: AppContainer,
  body: { vendorApi?: z.infer<typeof VendorApiSchema> | null }
): { apiVendor: "fortigate" | "sophos" | null; apiCredsEnc: string | null } | undefined {
  if (body.vendorApi === null) return { apiVendor: null, apiCredsEnc: null }; // explicit clear
  if (!body.vendorApi) return undefined; // untouched
  const vendorApi = body.vendorApi;
  if (vendorApi.vendor === "fortigate") {
    const { vendor, ...cred } = vendorApi;
    return { apiVendor: vendor, apiCredsEnc: encryptSecret(app.instanceKey, serializeVendorApiCredential(cred)) };
  }
  const { vendor, ...cred } = vendorApi;
  return { apiVendor: vendor, apiCredsEnc: encryptSecret(app.instanceKey, serializeSophosApiCredential(cred)) };
}

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
  snmpVersion: z.enum(["1", "2c"]).optional(),
  snmpV3: SnmpV3Schema.optional(),
  vendorApi: VendorApiSchema.optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  uplinkDeviceId: z.string().nullable().optional(),
  criticalAsset: z.boolean().optional(),
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
  snmpVersion: z.enum(["1", "2c"]).optional(),
  snmpV3: SnmpV3Schema.optional(),
  vendorApi: VendorApiSchema.nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  uplinkDeviceId: z.string().nullable().optional(),
  criticalAsset: z.boolean().optional(),
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

  // Live SNMP ifTable walk for the Bandwidth page's "Discover interfaces" picker — same trust
  // level as editing a check's config (operator), since it round-trips this device's decrypted
  // SNMP credentials over the network on demand rather than waiting for the next scheduled poll.
  router.get("/devices/:id/snmp-interfaces", requireAuth(app), requireRole("operator"), assertGroupAccess(app), async (c) => {
    const device = await app.repos.device.findById(tenantOf(c), c.req.param("id")!);
    if (!device) return c.json({ error: "NOT_FOUND" }, 404);
    if (!device.snmpCredsEnc) return c.json({ error: "NO_SNMP_CREDENTIALS" }, 400);

    try {
      const credential = parseSnmpCredential(decryptSecret(app.instanceKey, device.snmpCredsEnc));
      const interfaces = await discoverSnmpInterfaces(device.ip, credential);
      return c.json({ interfaces });
    } catch (err) {
      return c.json({ error: "DISCOVERY_FAILED", message: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  router.post("/devices", requireAuth(app), requireRole("operator"), validateJson(CreateDeviceSchema), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const body = getValidated<typeof CreateDeviceSchema>(c);
    try {
      const apiCreds = buildApiCredsEnc(app, body);
      const device = await createDevice(app, tenantId, user.id, {
        ...body,
        snmpCredsEnc: buildSnmpCredsEnc(app, body) ?? null,
        ...(apiCreds ?? {}),
      });
      return c.json(device, 201);
    } catch (err) {
      if (err instanceof InvalidSnmpV3Error) return c.json({ error: "INVALID_SNMP_V3", message: err.message }, 400);
      if (err instanceof DuplicateDeviceError) return c.json({ error: "DUPLICATE_IP", message: err.message }, 409);
      if (err instanceof LicenseLimitError) return c.json({ error: "LICENSE_LIMIT_EXCEEDED", message: err.message }, 402);
      throw err;
    }
  });

  router.patch("/devices/:id", requireAuth(app), requireRole("operator"), assertGroupAccess(app), validateJson(UpdateDeviceSchema), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const body = getValidated<typeof UpdateDeviceSchema>(c);
    const { snmpCommunity, snmpVersion, snmpV3, vendorApi, ...rest } = body;
    let snmpCredsEnc: string | null | undefined;
    try {
      snmpCredsEnc = buildSnmpCredsEnc(app, { snmpCommunity, snmpVersion, snmpV3 });
    } catch (err) {
      if (err instanceof InvalidSnmpV3Error) return c.json({ error: "INVALID_SNMP_V3", message: err.message }, 400);
      throw err;
    }
    const apiCreds = buildApiCredsEnc(app, { vendorApi });
    const patch = { ...rest, ...(snmpCredsEnc !== undefined ? { snmpCredsEnc } : {}), ...(apiCreds ?? {}) };
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

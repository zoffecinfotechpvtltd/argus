import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import { startDiscoveryJob, getDiscoveryJob } from "@application/discovery/runDiscovery";
import { importDiscoveredDevices } from "@application/discovery/importDiscoveredDevices";
import { LicenseLimitError } from "@application/license";
import { encryptSecret } from "@adapters/crypto";
import { InvalidCidrError, parseCidr } from "@domain/cidr";
import type { DeviceType } from "@domain/entities";
import type { AppEnv } from "@api/honoTypes";

const ScanSchema = z.object({
  cidr: z.string().min(9).max(32),
  snmpCommunity: z.string().min(1).max(200).optional(),
});

const DeviceTypeEnum = z.enum(["camera", "firewall", "switch", "router", "server", "workstation", "printer", "access_point", "nas", "iot", "unknown"]);

const ImportSchema = z.object({
  jobId: z.string(),
  snmpCommunity: z.string().min(1).max(200).optional(),
  selections: z
    .array(
      z.object({
        ip: z.string(),
        mac: z.string().nullable().optional(),
        vendor: z.string().nullable().optional(),
        type: DeviceTypeEnum,
        openPorts: z.array(z.number()).default([]),
        name: z.string().optional(),
        groupId: z.string().nullable().optional(),
        responsibleUserId: z.string().nullable().optional(),
        intervalSec: z.number().int().min(10).max(86400).optional(),
      })
    )
    .min(1)
    .max(1024),
});

export function discoveryRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.post("/discovery/scan", requireAuth(app), requireRole("operator"), validateJson(ScanSchema), async (c) => {
    const tenantId = tenantOf(c);
    const body = getValidated<typeof ScanSchema>(c);
    try {
      const job = startDiscoveryJob(app, tenantId, body.cidr, body.snmpCommunity);
      return c.json({ jobId: job.id, status: job.status });
    } catch (err) {
      if (err instanceof InvalidCidrError) return c.json({ error: "INVALID_CIDR", message: err.message }, 400);
      throw err;
    }
  });

  // Registered before the "/discovery/:jobId" wildcard GET below — Hono matches routes in
  // registration order, so "/discovery/schedules" would otherwise be captured by :jobId (treating
  // "schedules" as a job id and 404ing) and this handler would never run.
  router.get("/discovery/schedules", requireAuth(app), requireRole("operator"), async (c) => {
    return c.json(await app.repos.discoverySchedule.list(tenantOf(c)));
  });

  router.get("/discovery/:jobId", requireAuth(app), requireRole("viewer"), async (c) => {
    const job = getDiscoveryJob(app, tenantOf(c), c.req.param("jobId")!);
    if (!job) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(job);
  });

  router.post("/discovery/import", requireAuth(app), requireRole("operator"), validateJson(ImportSchema), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const body = getValidated<typeof ImportSchema>(c);

    const job = getDiscoveryJob(app, tenantId, body.jobId);

    const selections = body.selections.map((sel) => {
      const scannedMatch = job?.results.find((r) => r.ip === sel.ip);
      const hasSnmpPort = (sel.openPorts.length > 0 ? sel.openPorts : scannedMatch?.openPorts ?? []).includes(161);
      return {
        ip: sel.ip,
        mac: sel.mac ?? scannedMatch?.mac ?? null,
        vendor: sel.vendor ?? scannedMatch?.vendor ?? null,
        type: sel.type as DeviceType,
        openPorts: sel.openPorts.length > 0 ? sel.openPorts : scannedMatch?.openPorts ?? [],
        name: sel.name,
        groupId: sel.groupId,
        responsibleUserId: sel.responsibleUserId,
        intervalSec: sel.intervalSec,
        snmpCredsEnc: hasSnmpPort && body.snmpCommunity ? encryptSecret(app.instanceKey, body.snmpCommunity) : null,
      };
    });

    try {
      const result = await importDiscoveredDevices(app, tenantId, user.id, selections);
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof LicenseLimitError) return c.json({ error: "LICENSE_LIMIT_EXCEEDED", message: err.message }, 402);
      throw err;
    }
  });

  const CreateScheduleSchema = z.object({
    cidr: z.string().min(9).max(32),
    snmpCommunity: z.string().min(1).max(200).optional(),
    recurrence: z.enum(["daily", "weekly"]),
    targetGroupId: z.string().nullable().optional(),
  });

  router.post("/discovery/schedules", requireAuth(app), requireRole("operator"), validateJson(CreateScheduleSchema), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const body = getValidated<typeof CreateScheduleSchema>(c);
    try {
      parseCidr(body.cidr);
    } catch (err) {
      if (err instanceof InvalidCidrError) return c.json({ error: "INVALID_CIDR", message: err.message }, 400);
      throw err;
    }
    const now = app.clock.nowIso();
    const schedule = await app.repos.discoverySchedule.create({
      id: randomUUID(),
      tenantId,
      cidr: body.cidr,
      snmpCredsEnc: body.snmpCommunity ? encryptSecret(app.instanceKey, body.snmpCommunity) : null,
      recurrence: body.recurrence,
      targetGroupId: body.targetGroupId ?? null,
      enabled: true,
      lastRunAt: null,
      nextRunAt: now,
      createdBy: user.id,
      createdAt: now,
    });
    await app.repos.audit.record({
      tenantId,
      userId: user.id,
      action: "discovery.schedule_create",
      entityType: "discovery_schedule",
      entityId: schedule.id,
      detail: { cidr: schedule.cidr, recurrence: schedule.recurrence },
      createdAt: now,
    });
    return c.json(schedule, 201);
  });

  router.delete("/discovery/schedules/:id", requireAuth(app), requireRole("operator"), async (c) => {
    const ok = await app.repos.discoverySchedule.delete(tenantOf(c), c.req.param("id")!);
    if (!ok) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });

  return router;
}

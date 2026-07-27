import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const CreateMaintenanceSchema = z.object({
  deviceId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  recurrence: z.string().nullable().optional(),
});

export function maintenanceRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/maintenance", requireAuth(app), requireRole("viewer"), async (c) => {
    const deviceId = c.req.query("deviceId");
    const all = await app.repos.maintenance.list(tenantOf(c));
    return c.json(deviceId ? all.filter((w) => w.deviceId === deviceId) : all);
  });

  router.post("/maintenance", requireAuth(app), requireRole("operator"), validateJson(CreateMaintenanceSchema), async (c) => {
    const user = c.get("user");
    const tenantId = tenantOf(c);
    const body = getValidated<typeof CreateMaintenanceSchema>(c);
    const now = app.clock.nowIso();

    const window = await app.repos.maintenance.create({
      id: randomUUID(),
      tenantId,
      deviceId: body.deviceId ?? null,
      groupId: body.groupId ?? null,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      recurrence: body.recurrence ?? null,
      createdBy: user.id,
      createdAt: now,
    });

    await app.repos.audit.record({
      tenantId,
      userId: user.id,
      action: "maintenance.create",
      entityType: "maintenance_window",
      entityId: window.id,
      detail: { deviceId: body.deviceId, groupId: body.groupId, startsAt: body.startsAt, endsAt: body.endsAt },
      createdAt: now,
    });

    return c.json(window, 201);
  });

  router.delete("/maintenance/:id", requireAuth(app), requireRole("operator"), async (c) => {
    const user = c.get("user");
    const tenantId = tenantOf(c);
    const ok = await app.repos.maintenance.delete(tenantId, c.req.param("id")!);
    if (!ok) return c.json({ error: "NOT_FOUND" }, 404);

    await app.repos.audit.record({
      tenantId,
      userId: user.id,
      action: "maintenance.delete",
      entityType: "maintenance_window",
      entityId: c.req.param("id")!,
      detail: null,
      createdAt: app.clock.nowIso(),
    });

    return c.json({ ok: true });
  });

  return router;
}

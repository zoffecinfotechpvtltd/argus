import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import type { AppEnv } from "@api/honoTypes";

const CreateSchema = z.object({
  groupId: z.string().min(1),
  userIds: z.array(z.string()).min(1),
  shiftLengthHours: z.number().int().min(1).max(24 * 30),
  rotationStartAt: z.string().min(1),
});

const UpdateSchema = z.object({
  userIds: z.array(z.string()).min(1).optional(),
  shiftLengthHours: z.number().int().min(1).max(24 * 30).optional(),
  rotationStartAt: z.string().min(1).optional(),
});

/** One on-call rotation per device group (M4) — the group's escalation chain references it via
 * `EscalationStep.onCall: true` steps rather than a fixed userId (see application/escalation.ts). */
export function onCallRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/oncall-schedules", requireAuth(app), requireRole("viewer"), async (c) => {
    return c.json(await app.repos.onCallSchedule.list(tenantOf(c)));
  });

  router.get("/groups/:groupId/oncall-schedule", requireAuth(app), requireRole("viewer"), async (c) => {
    const schedule = await app.repos.onCallSchedule.findByGroup(tenantOf(c), c.req.param("groupId")!);
    if (!schedule) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(schedule);
  });

  router.post("/oncall-schedules", requireAuth(app), requireRole("operator"), validateJson(CreateSchema), async (c) => {
    const tenantId = tenantOf(c);
    const body = getValidated<typeof CreateSchema>(c);

    const group = await app.repos.group.findById(tenantId, body.groupId);
    if (!group) return c.json({ error: "GROUP_NOT_FOUND" }, 404);

    const existing = await app.repos.onCallSchedule.findByGroup(tenantId, body.groupId);
    if (existing) return c.json({ error: "SCHEDULE_ALREADY_EXISTS", message: "This group already has an on-call schedule — update it instead." }, 409);

    const now = app.clock.nowIso();
    const schedule = await app.repos.onCallSchedule.create({
      id: randomUUID(),
      tenantId,
      groupId: body.groupId,
      userIds: body.userIds,
      shiftLengthHours: body.shiftLengthHours,
      rotationStartAt: body.rotationStartAt,
      createdAt: now,
      updatedAt: now,
    });
    return c.json(schedule, 201);
  });

  router.patch("/oncall-schedules/:id", requireAuth(app), requireRole("operator"), validateJson(UpdateSchema), async (c) => {
    const body = getValidated<typeof UpdateSchema>(c);
    const updated = await app.repos.onCallSchedule.update(tenantOf(c), c.req.param("id")!, body);
    if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(updated);
  });

  router.delete("/oncall-schedules/:id", requireAuth(app), requireRole("operator"), async (c) => {
    const ok = await app.repos.onCallSchedule.delete(tenantOf(c), c.req.param("id")!);
    if (!ok) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });

  return router;
}

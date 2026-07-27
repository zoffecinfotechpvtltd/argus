import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import { createGroup, deleteGroup, updateGroup } from "@application/groups/groupUseCases";
import type { AppEnv } from "@api/honoTypes";

const EscalationStepSchema = z
  .object({ userId: z.string().optional(), onCall: z.boolean().optional(), afterMinutes: z.number().int().min(1).max(1440) })
  .refine((s) => !!s.userId || !!s.onCall, "Each escalation step needs either userId or onCall:true");

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(120),
  escalationChain: z.array(EscalationStepSchema).optional(),
});

const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  escalationChain: z.array(EscalationStepSchema).optional(),
});

export function groupRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/groups", requireAuth(app), requireRole("viewer"), async (c) => {
    return c.json(await app.repos.group.list(tenantOf(c)));
  });

  router.post("/groups", requireAuth(app), requireRole("operator"), validateJson(CreateGroupSchema), async (c) => {
    const user = c.get("user");
    const body = getValidated<typeof CreateGroupSchema>(c);
    const group = await createGroup(app, tenantOf(c), user.id, body);
    return c.json(group, 201);
  });

  router.patch("/groups/:id", requireAuth(app), requireRole("operator"), validateJson(UpdateGroupSchema), async (c) => {
    const user = c.get("user");
    const body = getValidated<typeof UpdateGroupSchema>(c);
    const group = await updateGroup(app, tenantOf(c), user.id, c.req.param("id")!, body);
    if (!group) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(group);
  });

  router.delete("/groups/:id", requireAuth(app), requireRole("operator"), async (c) => {
    const user = c.get("user");
    const ok = await deleteGroup(app, tenantOf(c), user.id, c.req.param("id")!);
    if (!ok) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });

  return router;
}

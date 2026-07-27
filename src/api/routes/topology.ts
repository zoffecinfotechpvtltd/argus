import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const SavePositionSchema = z.object({
  nodeId: z.string(),
  x: z.number(),
  y: z.number(),
});

export function topologyRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/topology/positions", requireAuth(app), requireRole("viewer"), async (c) => {
    const user = c.get("user");
    const positions = await app.repos.topology.listPositions(tenantOf(c), user.id);
    return c.json(positions);
  });

  router.put("/topology/positions", requireAuth(app), requireRole("viewer"), validateJson(SavePositionSchema), async (c) => {
    const user = c.get("user");
    const { nodeId, x, y } = getValidated<typeof SavePositionSchema>(c);
    await app.repos.topology.savePosition(tenantOf(c), user.id, nodeId, x, y);
    return c.json({ ok: true });
  });

  return router;
}

import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const UpdateCheckSchema = z.object({
  enabled: z.boolean().optional(),
  thresholds: z.object({ latencyMs: z.number().optional(), lossPct: z.number().optional() }).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export function checkRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/devices/:deviceId/checks", requireAuth(app), requireRole("viewer"), async (c) => {
    const checks = await app.repos.check.listByDevice(tenantOf(c), c.req.param("deviceId")!);
    return c.json(checks);
  });

  router.patch("/checks/:id", requireAuth(app), requireRole("operator"), validateJson(UpdateCheckSchema), async (c) => {
    const body = getValidated<typeof UpdateCheckSchema>(c);
    const tenantId = tenantOf(c);
    const existing = await app.repos.check.findById(tenantId, c.req.param("id")!);
    if (!existing) return c.json({ error: "NOT_FOUND" }, 404);

    const updated = await app.repos.check.update(tenantId, c.req.param("id")!, {
      enabled: body.enabled ?? existing.enabled,
      thresholds: { ...existing.thresholds, ...body.thresholds },
      config: { ...existing.config, ...(body.config as object | undefined) },
    });
    return c.json(updated);
  });

  return router;
}

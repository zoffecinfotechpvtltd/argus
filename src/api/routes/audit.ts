import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateQuery, getValidatedQuery } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const AuditQuerySchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function auditRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/audit", requireAuth(app), requireRole("admin"), validateQuery(AuditQuerySchema), async (c) => {
    const q = getValidatedQuery<typeof AuditQuerySchema>(c);
    const page = await app.repos.audit.list(tenantOf(c), q);
    return c.json(page);
  });

  return router;
}

import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf, getClientIp } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import { rateLimit } from "@api/middleware/rateLimit";
import { generatePublicStatusPage, getStatusPageConfig, setStatusPageConfig } from "@application/statusPage";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const StatusPageConfigSchema = z.object({
  enabled: z.boolean(),
  title: z.string().max(120),
  deviceIds: z.array(z.string()).max(2000),
  groupIds: z.array(z.string()).max(2000),
});

export function statusPageRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  // Admin config — authenticated, own tenant only. Registered under a distinct top-level prefix
  // (not nested under /status-page/*) so it can never collide with the public :tenantSlug route
  // below no matter what a tenant id happens to look like.
  router.get("/status-page-config", requireAuth(app), requireRole("admin"), async (c) => {
    return c.json(await getStatusPageConfig(app, tenantOf(c)));
  });

  router.put("/status-page-config", requireAuth(app), requireRole("admin"), validateJson(StatusPageConfigSchema), async (c) => {
    const body = getValidated<typeof StatusPageConfigSchema>(c);
    await setStatusPageConfig(app, tenantOf(c), body);
    await app.repos.audit.record({
      tenantId: tenantOf(c),
      userId: c.get("user").id,
      action: "statusPage.config.update",
      entityType: "statusPageConfig",
      entityId: null,
      detail: { enabled: body.enabled, deviceCount: body.deviceIds.length, groupCount: body.groupIds.length },
      createdAt: app.clock.nowIso(),
    });
    return c.json({ ok: true });
  });

  // Public — deliberately outside requireAuth. `tenantSlug` is the tenant's own id (see
  // StatusPageConfig's doc comment: this app has no separate slug concept yet — the tenant id is
  // already an opaque, non-guessable identifier with no consumer-facing sensitivity of its own,
  // so introducing a second identity for the same row just to look nicer in a URL isn't worth it
  // for this milestone). A tenant that hasn't opted in gets the same 404 as one that doesn't
  // exist — the response never confirms or denies a given id is a real tenant.
  router.get("/status-page/:tenantSlug", rateLimit({ max: 60, windowMs: 60_000, keyPrefix: "status-page", keyFn: getClientIp }), async (c) => {
    const page = await generatePublicStatusPage(app, c.req.param("tenantSlug")!);
    if (!page) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(page);
  });

  return router;
}

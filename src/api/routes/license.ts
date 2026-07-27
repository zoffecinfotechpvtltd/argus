import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";
import { effectiveDeviceLimit, TRIAL_DEVICE_LIMIT } from "@domain/license";

const ApplyLicenseSchema = z.object({
  licenseKey: z.string().min(1).max(4000),
});

export function licenseRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/license", requireAuth(app), requireRole("admin"), async (c) => {
    const state = await app.license.getState(tenantOf(c));
    const page = await app.repos.device.list(tenantOf(c), { limit: 1, offset: 0 });
    return c.json({
      status: state.status,
      customer: "payload" in state ? state.payload.customer : null,
      plan: "payload" in state ? state.payload.plan : null,
      deviceLimit: effectiveDeviceLimit(state),
      trialDeviceLimit: TRIAL_DEVICE_LIMIT,
      expiresAt: "payload" in state ? state.payload.expiresAt : null,
      graceDaysLeft: state.status === "grace" ? state.graceDaysLeft : null,
      invalidReason: state.status === "invalid" ? state.reason : null,
      deviceCount: page.total,
    });
  });

  router.post("/license", requireAuth(app), requireRole("admin"), validateJson(ApplyLicenseSchema), async (c) => {
    const { licenseKey } = getValidated<typeof ApplyLicenseSchema>(c);
    try {
      const state = await app.license.applyLicenseFile(licenseKey);
      await app.repos.audit.record({
        tenantId: tenantOf(c),
        userId: c.get("user").id,
        action: "license.apply",
        entityType: "license",
        entityId: "payload" in state ? state.payload.licenseId : null,
        detail: "payload" in state ? { customer: state.payload.customer, plan: state.payload.plan, expiresAt: state.payload.expiresAt } : null,
        createdAt: app.clock.nowIso(),
      });
      return c.json({ ok: true, status: state.status });
    } catch (err) {
      return c.json({ error: "INVALID_LICENSE", message: (err as Error).message }, 400);
    }
  });

  return router;
}

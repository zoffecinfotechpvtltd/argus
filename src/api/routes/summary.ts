import { Hono } from "hono";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { requireAuthOrApiKey } from "@api/middleware/apiKey";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";
import { generateSlaReport } from "@application/reports";

export function summaryRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/summary", requireAuthOrApiKey(app), requireRole("viewer"), async (c) => {
    const tenantId = tenantOf(c);
    const [statusSummary, alertSummary] = await Promise.all([
      app.repos.status.summary(tenantId),
      app.repos.alert.countOpenBySeverity(tenantId),
    ]);

    const totalDevices = Object.values(statusSummary).reduce((a, b) => a + b, 0);

    const now = app.clock.now();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const slaToday = await generateSlaReport(app, tenantId, { fromIso: todayStart.toISOString(), toIso: now.toISOString() });
    const availabilityTodayPct = slaToday.length > 0 ? Math.round((slaToday.reduce((s, r) => s + r.availabilityPct, 0) / slaToday.length) * 100) / 100 : 100;

    return c.json({
      totalDevices,
      byState: statusSummary,
      openAlerts: alertSummary,
      availabilityTodayPct,
    });
  });

  router.get("/engine/status", requireAuth(app), requireRole("viewer"), (c) => {
    const lastTickAt = app.engineHeartbeat.lastTickAt();
    const ageMs = Date.now() - lastTickAt;
    const lagging = ageMs > app.config.polling.defaultIntervalSec * 1000 * 2;
    return c.json({ running: true, lastTickAt, ageMs, lagging });
  });

  return router;
}

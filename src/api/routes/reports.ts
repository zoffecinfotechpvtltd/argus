import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { requireAuthOrApiKey } from "@api/middleware/apiKey";
import { validateQuery, validateJson, getValidatedQuery, getValidated } from "@api/middleware/validate";
import { alertsSummaryToCsv, generateInventoryReport, generateSlaReport, inventoryReportToCsv, slaReportToCsv } from "@application/reports";
import { REPORTS_SCHEDULE_KEY, type ScheduledReportConfig } from "@application/digestScheduler";
import { DEFAULT_TENANT_ID } from "@domain/entities";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const SlaQuerySchema = z.object({
  groupId: z.string().optional(),
  from: z.string(),
  to: z.string(),
  format: z.enum(["json", "csv"]).default("json"),
});

const AlertsSummaryQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
  format: z.enum(["json", "csv"]).default("json"),
});

export function reportRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/reports/sla", requireAuthOrApiKey(app), requireRole("viewer"), validateQuery(SlaQuerySchema), async (c) => {
    const tenantId = tenantOf(c);
    const q = getValidatedQuery<typeof SlaQuerySchema>(c);
    const rows = await generateSlaReport(app, tenantId, { groupId: q.groupId, fromIso: q.from, toIso: q.to });

    if (q.format === "csv") {
      return new Response(slaReportToCsv(rows), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sla-report.csv"' },
      });
    }
    return c.json(rows);
  });

  router.get(
    "/reports/alerts-summary",
    requireAuthOrApiKey(app),
    requireRole("viewer"),
    validateQuery(AlertsSummaryQuerySchema),
    async (c) => {
      const tenantId = tenantOf(c);
      const q = getValidatedQuery<typeof AlertsSummaryQuerySchema>(c);
      const rows = await app.repos.alert.countByDayAndSeverity(tenantId, q.from, q.to);

      if (q.format === "csv") {
        return new Response(alertsSummaryToCsv(rows), {
          headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="alerts-summary.csv"' },
        });
      }
      return c.json(rows);
    }
  );

  router.get("/reports/inventory", requireAuth(app), requireRole("viewer"), async (c) => {
    const rows = await generateInventoryReport(app, tenantOf(c));
    const format = c.req.query("format");
    if (format === "csv") {
      return new Response(inventoryReportToCsv(rows), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="inventory-report.csv"' },
      });
    }
    return c.json(rows);
  });

  const ScheduledReportSchema = z.object({
    enabled: z.boolean(),
    recipients: z.array(z.string().email()).max(20),
    recurrence: z.enum(["daily", "weekly"]),
  });

  router.get("/reports/schedule", requireAuth(app), requireRole("admin"), async (c) => {
    const raw = await app.repos.settings.get(DEFAULT_TENANT_ID, REPORTS_SCHEDULE_KEY);
    const config: ScheduledReportConfig = raw ? JSON.parse(raw) : { enabled: false, recipients: [], recurrence: "daily", lastSentAt: null };
    return c.json(config);
  });

  router.put("/reports/schedule", requireAuth(app), requireRole("admin"), validateJson(ScheduledReportSchema), async (c) => {
    const body = getValidated<typeof ScheduledReportSchema>(c);
    const raw = await app.repos.settings.get(DEFAULT_TENANT_ID, REPORTS_SCHEDULE_KEY);
    const existing: ScheduledReportConfig = raw ? JSON.parse(raw) : { enabled: false, recipients: [], recurrence: "daily", lastSentAt: null };
    const config: ScheduledReportConfig = { ...body, lastSentAt: existing.lastSentAt };
    await app.repos.settings.set(DEFAULT_TENANT_ID, REPORTS_SCHEDULE_KEY, JSON.stringify(config));
    return c.json({ ok: true });
  });

  return router;
}

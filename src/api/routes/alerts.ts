import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { requireAuthOrApiKey } from "@api/middleware/apiKey";
import { validateQuery, validateJson, getValidatedQuery, getValidated } from "@api/middleware/validate";
import { acknowledgeAlert, resolveAlertManually } from "@application/alertActions";
import type { AppEnv } from "@api/honoTypes";

const ListAlertsQuerySchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved"]).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  deviceId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function alertRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/alerts", requireAuthOrApiKey(app), requireRole("viewer"), validateQuery(ListAlertsQuerySchema), async (c) => {
    const q = getValidatedQuery<typeof ListAlertsQuerySchema>(c);
    const page = await app.repos.alert.list(tenantOf(c), q);
    return c.json(page);
  });

  router.get("/alerts/:id/ack", async (c) => {
    const alertId = c.req.param("id")!;
    const token = c.req.query("token");
    if (!token || !app.tokenSigner.verifyAckToken(alertId, token)) {
      return c.html("<h1>Invalid or expired acknowledgement link</h1>", 403);
    }
    const alert = await app.repos.alert.findByIdAnyTenant(alertId);
    if (!alert) return c.html("<h1>Alert not found</h1>", 404);

    const acked = await acknowledgeAlert(app, alert.tenantId, alertId, null);
    return c.html(
      `<html><body style="font-family:sans-serif;text-align:center;padding:60px;">
         <h1>Acknowledged</h1>
         <p>${escapeHtml(acked?.title ?? alert.title)}</p>
         <p style="color:#64748b;">You can close this window.</p>
       </body></html>`
    );
  });

  router.post("/alerts/:id/ack", requireAuth(app), requireRole("operator"), async (c) => {
    const user = c.get("user");
    const acked = await acknowledgeAlert(app, tenantOf(c), c.req.param("id")!, user.id);
    if (!acked) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(acked);
  });

  router.post("/alerts/:id/resolve", requireAuth(app), requireRole("operator"), async (c) => {
    const user = c.get("user");
    const resolved = await resolveAlertManually(app, tenantOf(c), c.req.param("id")!, user.id);
    if (!resolved) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(resolved);
  });

  router.get("/alerts/:id/notes", requireAuth(app), requireRole("viewer"), async (c) => {
    const notes = await app.repos.alertNote.listByAlert(tenantOf(c), c.req.param("id")!);
    return c.json(notes);
  });

  const AddNoteSchema = z.object({ body: z.string().min(1).max(2000) });

  router.post("/alerts/:id/notes", requireAuth(app), requireRole("operator"), validateJson(AddNoteSchema), async (c) => {
    const user = c.get("user");
    const { body } = getValidated<typeof AddNoteSchema>(c);
    const note = await app.repos.alertNote.create({
      id: randomUUID(),
      tenantId: tenantOf(c),
      alertId: c.req.param("id")!,
      userId: user.id,
      body,
      createdAt: app.clock.nowIso(),
    });
    return c.json(note, 201);
  });

  router.get("/notifications/log", requireAuth(app), requireRole("viewer"), async (c) => {
    const limit = Number(c.req.query("limit") ?? "200");
    return c.json(await app.repos.notificationLog.list(tenantOf(c), limit));
  });

  // M4 incident timeline: a read-model merging audit entries (open/ack/resolve/storm-guard) and
  // notification attempts for one alert into a single ordered view — not a new write path, exactly
  // per SAAS_GAPS' note that this data already exists in the audit log and notification log.
  router.get("/alerts/:id/timeline", requireAuth(app), requireRole("viewer"), async (c) => {
    const tenantId = tenantOf(c);
    const alertId = c.req.param("id")!;
    const alert = await app.repos.alert.findById(tenantId, alertId);
    if (!alert) return c.json({ error: "NOT_FOUND" }, 404);

    const [auditPage, notifications] = await Promise.all([
      app.repos.audit.list(tenantId, { entityType: "alert", entityId: alertId, limit: 500 }),
      app.repos.notificationLog.listByAlert(tenantId, alertId),
    ]);

    const events = [
      ...auditPage.items.map((a) => ({ kind: "audit" as const, at: a.createdAt, action: a.action, detail: a.detail })),
      ...notifications.map((n) => ({ kind: "notification" as const, at: n.createdAt, channel: n.channel, status: n.status, error: n.error })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    return c.json({ alert, events });
  });

  return router;
}

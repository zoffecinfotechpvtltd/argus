import type { AppContainer } from "@ports/context";
import type { Alert } from "@domain/entities";

export async function acknowledgeAlert(app: AppContainer, tenantId: string, alertId: string, actorUserId: string | null): Promise<Alert | null> {
  const alert = await app.repos.alert.findById(tenantId, alertId);
  if (!alert || alert.status !== "open") return alert;

  const now = app.clock.nowIso();
  const updated = await app.repos.alert.update(tenantId, alertId, { status: "acknowledged", ackedBy: actorUserId, ackedAt: now });
  if (!updated) return null;

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "alert.ack",
    entityType: "alert",
    entityId: alertId,
    detail: { via: actorUserId ? "ui" : "one-click-link" },
    createdAt: now,
  });
  app.events.emit("alert.changed", { alertId, tenantId, status: "acknowledged" });

  return updated;
}

export async function resolveAlertManually(app: AppContainer, tenantId: string, alertId: string, actorUserId: string): Promise<Alert | null> {
  const alert = await app.repos.alert.findById(tenantId, alertId);
  if (!alert || alert.status === "resolved") return alert;

  const now = app.clock.nowIso();
  const updated = await app.repos.alert.update(tenantId, alertId, { status: "resolved", resolvedAt: now });
  if (!updated) return null;

  await app.repos.audit.record({
    tenantId,
    userId: actorUserId,
    action: "alert.resolve",
    entityType: "alert",
    entityId: alertId,
    detail: { auto: false },
    createdAt: now,
  });
  app.events.emit("alert.changed", { alertId, tenantId, status: "resolved" });

  return updated;
}

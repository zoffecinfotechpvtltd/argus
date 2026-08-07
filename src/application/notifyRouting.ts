import type { AppContainer } from "@ports/context";
import type { Alert, Device, NotificationChannel } from "@domain/entities";
import { shouldNotifyNow } from "@domain/notificationPolicy";

function resolveTarget(
  channel: NotificationChannel,
  email: string,
  targets: { webhookUrl: string | null; slackWebhookUrl: string | null; teamsWebhookUrl: string | null; pagerdutyRoutingKey: string | null }
): string | null {
  if (channel === "email") return email;
  if (channel === "webhook") return targets.webhookUrl;
  if (channel === "slack") return targets.slackWebhookUrl;
  if (channel === "teams") return targets.teamsWebhookUrl;
  if (channel === "pagerduty") return targets.pagerdutyRoutingKey;
  return null;
}

/** Routes one alert notification to one user through every channel they've enabled, honoring severity floor + quiet hours. */
export async function notifyUser(
  app: AppContainer,
  userId: string,
  alert: Alert,
  device: Device,
  ackUrl?: string,
  affectedDevices?: Array<{ name: string; ip: string }>
): Promise<void> {
  const user = await app.repos.user.findById(device.tenantId, userId);
  if (!user || user.disabled) return;

  const prefs = await app.repos.notificationPrefs.get(device.tenantId, userId);
  const channels = prefs?.channels ?? ["email"];
  const severityFloor = prefs?.severityFloor ?? "warning";

  const now = app.clock.now();
  const nowHHMM = now.toISOString().slice(11, 16);
  if (
    !shouldNotifyNow({
      severity: alert.severity,
      severityFloor,
      quietHoursStart: prefs?.quietHoursStart ?? null,
      quietHoursEnd: prefs?.quietHoursEnd ?? null,
      nowHHMM,
    })
  ) {
    return;
  }

  const nowIso = app.clock.nowIso();
  for (const channel of channels) {
    const target = resolveTarget(channel, user.email, {
      webhookUrl: prefs?.webhookUrl ?? null,
      slackWebhookUrl: prefs?.slackWebhookUrl ?? null,
      teamsWebhookUrl: prefs?.teamsWebhookUrl ?? null,
      pagerdutyRoutingKey: prefs?.pagerdutyRoutingKey ?? null,
    });
    if (!target) continue;

    const notifier = app.notifiers.get(channel);
    const result = await notifier.send(target, { alert, device, tenantId: device.tenantId, ackUrl, affectedDevices });
    await app.repos.notificationLog.record({
      tenantId: device.tenantId,
      alertId: alert.id,
      channel,
      target,
      status: result.ok ? "sent" : "failed",
      error: result.error ?? null,
      createdAt: nowIso,
    });
    if (!result.ok) {
      app.logger.warn("notification_send_failed", { channel, alertId: alert.id, error: result.error });
    }
  }
}

export function buildAckUrl(app: AppContainer, alertId: string): string {
  const token = app.tokenSigner.signAckToken(alertId, 24 * 60 * 60 * 1000);
  return `http://localhost:${app.config.port}/api/alerts/${alertId}/ack?token=${encodeURIComponent(token)}`;
}

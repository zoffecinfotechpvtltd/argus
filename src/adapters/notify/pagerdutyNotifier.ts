import type { Notifier, NotifyPayload, NotifyResult } from "@ports/services";
import type { AlertSeverity, NotificationChannel } from "@domain/entities";

const EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";

const SEVERITY_MAP: Record<AlertSeverity, "critical" | "warning" | "info"> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

/**
 * PagerDuty Events API v2 — target is a service's Events API v2 integration key (`routing_key`),
 * not a URL; the destination is always PagerDuty's own fixed endpoint, so this needs no SSRF guard
 * the way a user-supplied webhook URL does. `dedup_key` is set to the alert's own id so the
 * trigger/resolve pair for the same alert correlate to one PagerDuty incident instead of each
 * becoming its own — resolving in Argus resolves the page, it doesn't just log a second event.
 */
export class PagerDutyNotifier implements Notifier {
  channel: NotificationChannel = "pagerduty";

  private async enqueue(routingKey: string, event: Record<string, unknown>): Promise<NotifyResult> {
    try {
      const res = await fetch(EVENTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routing_key: routingKey, ...event }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `PagerDuty responded with status ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(target: string, payload: NotifyPayload): Promise<NotifyResult> {
    const { alert, device, affectedDevices } = payload;
    if (alert.resolvedAt) {
      return this.enqueue(target, { event_action: "resolve", dedup_key: alert.id });
    }
    return this.enqueue(target, {
      event_action: "trigger",
      dedup_key: alert.id,
      payload: {
        summary: affectedDevices?.length ? `${alert.title} (${affectedDevices.length} devices)` : `${alert.title} — ${device.name} (${device.ip})`,
        severity: SEVERITY_MAP[alert.severity],
        source: device.name,
        timestamp: alert.openedAt,
        custom_details: {
          detail: alert.detail ?? undefined,
          affectedDevices: affectedDevices?.map((d) => `${d.name} (${d.ip})`),
          ackUrl: payload.ackUrl,
        },
      },
    });
  }

  /** Triggers then immediately resolves a clearly-labeled test incident — a bare trigger would
   * leave a real, ringing page open in the admin's PagerDuty account until someone resolves it
   * by hand, which is a bad way to test a webhook. */
  async sendTest(_tenantId: string, target: string): Promise<NotifyResult> {
    const dedupKey = `argus-test-${Date.now()}`;
    const triggerResult = await this.enqueue(target, {
      event_action: "trigger",
      dedup_key: dedupKey,
      payload: { summary: "Argus test notification", severity: "info", source: "Argus", timestamp: new Date().toISOString() },
    });
    if (!triggerResult.ok) return triggerResult;
    return this.enqueue(target, { event_action: "resolve", dedup_key: dedupKey });
  }
}

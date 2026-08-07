import type { Notifier, NotifyPayload, NotifyResult } from "@ports/services";
import type { NotificationChannel } from "@domain/entities";
import { validateWebhookUrl } from "@adapters/notify/webhookNotifier";

const SEVERITY_COLOR: Record<string, string> = { critical: "DC2626", warning: "D97706", info: "0284C7" };

/** Posts to a Microsoft Teams Incoming Webhook URL using the legacy "MessageCard" schema —
 * Microsoft has been steering channels toward Workflows/Adaptive Cards, but classic Incoming
 * Webhooks (and MessageCard) still work today and need no Azure app registration, just a webhook
 * URL from the channel's connector settings. Same SSRF guard as the generic webhook/Slack
 * channels — this target is just as arbitrary a user-supplied URL. */
export class TeamsNotifier implements Notifier {
  channel: NotificationChannel = "teams";

  private async post(target: string, body: unknown): Promise<NotifyResult> {
    const guardError = await validateWebhookUrl(target);
    if (guardError) return { ok: false, error: guardError };
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: false, error: `Teams responded with status ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(target: string, payload: NotifyPayload): Promise<NotifyResult> {
    const { alert, device, affectedDevices } = payload;
    const facts = affectedDevices?.length
      ? [{ name: "Affected devices", value: affectedDevices.map((d) => `${d.name} (${d.ip})`).join(", ") }]
      : [
          { name: "Device", value: `${device.name} (${device.ip})` },
          { name: "Type", value: device.type },
        ];
    facts.push({ name: "Opened", value: alert.openedAt });

    return this.post(target, {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: SEVERITY_COLOR[alert.severity] ?? "71717A",
      summary: alert.title,
      sections: [
        {
          activityTitle: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          text: alert.detail ?? undefined,
          facts,
        },
      ],
      ...(payload.ackUrl
        ? { potentialAction: [{ "@type": "OpenUri", name: "Acknowledge", targets: [{ os: "default", uri: payload.ackUrl }] }] }
        : {}),
    });
  }

  async sendTest(_tenantId: string, target: string): Promise<NotifyResult> {
    return this.post(target, {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: "0284C7",
      summary: "Argus test notification",
      sections: [{ activityTitle: "Argus test notification", text: "If you see this in Teams, the webhook is configured correctly." }],
    });
  }
}

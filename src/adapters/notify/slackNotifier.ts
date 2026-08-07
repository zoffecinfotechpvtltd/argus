import type { Notifier, NotifyPayload, NotifyResult } from "@ports/services";
import type { NotificationChannel } from "@domain/entities";
import { validateWebhookUrl } from "@adapters/notify/webhookNotifier";
import { plainText } from "@adapters/notify/content";

const SEVERITY_COLOR: Record<string, string> = { critical: "#dc2626", warning: "#d97706", info: "#0284c7" };

/** Posts to a Slack Incoming Webhook URL — the classic `attachments` shape (not Block Kit), which
 * every incoming webhook still renders correctly and needs no app/scopes to set up, just the URL
 * from Slack's own "Incoming Webhooks" app config. Target is that full webhook URL, SSRF-guarded
 * the same way the generic webhook channel is (it's just as arbitrary/user-supplied a URL). */
export class SlackNotifier implements Notifier {
  channel: NotificationChannel = "slack";

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
      if (!res.ok) return { ok: false, error: `Slack responded with status ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(target: string, payload: NotifyPayload): Promise<NotifyResult> {
    const { alert } = payload;
    return this.post(target, {
      text: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      attachments: [
        {
          color: SEVERITY_COLOR[alert.severity] ?? "#71717a",
          text: plainText(payload),
          footer: "Argus",
          ts: Math.floor(new Date(alert.openedAt).getTime() / 1000),
        },
      ],
    });
  }

  async sendTest(_tenantId: string, target: string): Promise<NotifyResult> {
    return this.post(target, { text: "Argus test notification — if you see this in Slack, the webhook is configured correctly." });
  }
}

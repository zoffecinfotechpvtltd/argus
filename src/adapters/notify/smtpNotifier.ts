import nodemailer from "nodemailer";
import type { Notifier, NotifyPayload, NotifyResult } from "@ports/services";
import type { NotificationChannel } from "@domain/entities";
import { emailHtml, plainText } from "@adapters/notify/content";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpNotifier implements Notifier {
  channel: NotificationChannel = "email";

  constructor(
    private getConfig: (tenantId: string) => Promise<SmtpConfig | null>,
    private baseUrl: string
  ) {}

  private async transport(config: SmtpConfig) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(target: string, payload: NotifyPayload): Promise<NotifyResult> {
    const config = await this.getConfig(payload.tenantId);
    if (!config) return { ok: false, error: "SMTP is not configured" };
    try {
      const transport = await this.transport(config);
      await transport.sendMail({
        from: config.from,
        to: target,
        subject: payload.alert.title,
        text: plainText(payload),
        html: emailHtml(payload, this.baseUrl),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendTest(tenantId: string, target: string): Promise<NotifyResult> {
    const config = await this.getConfig(tenantId);
    if (!config) return { ok: false, error: "SMTP is not configured" };
    try {
      const transport = await this.transport(config);
      await transport.sendMail({
        from: config.from,
        to: target,
        subject: "Argus test email",
        text: "This is a test notification from Argus. If you received this, SMTP is configured correctly. Real alert emails use a richer HTML template with the alert's severity, device details, and an acknowledge button.",
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:8px;">
          <div style="display:inline-block;background:#0284c7;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:9999px;text-transform:uppercase;">Test</div>
          <h2 style="margin:12px 0 4px;">SMTP is configured correctly</h2>
          <p style="color:#475569;margin:0;">This is a test notification from Argus. Real alert emails use this same styling — a severity badge, device details, and an acknowledge button.</p>
        </div>`,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

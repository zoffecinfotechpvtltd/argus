import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { Notifier, NotifyPayload, NotifyResult } from "@ports/services";
import type { NotificationChannel } from "@domain/entities";
import { isBlockedAddress, isPrivateAddress } from "@domain/ssrfGuard";

export interface WebhookConfig {
  secret?: string;
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SSRF guard for webhook targets. Unlike an HTTP device check (which legitimately targets LAN
 * addresses — that's the whole product), a notification webhook is meant to reach an external
 * alerting endpoint, so this blocks loopback/link-local *and* RFC1918 private ranges via
 * isPrivateAddress — the lowest-privileged user able to set their own webhook target
 * (`PUT /notification-prefs` only requires `viewer`) must not be able to turn it into an internal
 * network probe, with `GET /notifications/log` reading back the result as an oracle.
 *
 * Known residual gap: this resolves DNS once here and `fetch()` resolves independently again when
 * the request actually goes out, so a low-TTL DNS-rebinding domain could pass this check pointing
 * at a public IP and have the record flip to a blocked address by the time fetch connects. Callers
 * re-run this immediately before every attempt (not just once) to keep that window as small as
 * practical; fully closing it needs connection-level IP pinning, which Bun's fetch doesn't expose.
 */
async function validateWebhookUrl(target: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return "Invalid webhook URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Webhook URL must be http(s)";

  try {
    const addresses = await lookup(parsed.hostname, { all: true });
    for (const addr of addresses) {
      if (addr.family !== 4) continue;
      if (isBlockedAddress(addr.address)) return `Blocked by SSRF guard: ${parsed.hostname} resolves to a link-local/loopback address`;
      if (isPrivateAddress(addr.address)) return `Blocked by SSRF guard: ${parsed.hostname} resolves to a private network address`;
    }
  } catch {
    return "Could not resolve webhook hostname";
  }
  return null;
}

export class WebhookNotifier implements Notifier {
  channel: NotificationChannel = "webhook";

  constructor(private getConfig: (tenantId: string) => Promise<WebhookConfig | null>) {}

  private buildBody(payload: NotifyPayload): string {
    // affectedDevices is only present for a storm/aggregate notification — included as a real
    // structured array (not just baked into alert.detail's string) so a receiving
    // integration (Slack/Teams/PagerDuty relay, etc.) can list every affected device itself
    // instead of surfacing only the single representative `device` field.
    return JSON.stringify({
      alert: payload.alert,
      device: payload.device,
      tenant: payload.tenantId,
      ...(payload.affectedDevices ? { affectedDevices: payload.affectedDevices } : {}),
    });
  }

  private sign(body: string, secret: string): string {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  async send(target: string, payload: NotifyPayload): Promise<NotifyResult> {
    const guardError = await validateWebhookUrl(target);
    if (guardError) return { ok: false, error: guardError };

    const config = await this.getConfig(payload.tenantId);
    const body = this.buildBody(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config?.secret) headers["X-Argus-Signature"] = `sha256=${this.sign(body, config.secret)}`;

    let lastError = "Unknown error";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Re-validated on every attempt, not just once up front — narrows the DNS-rebinding TOCTOU
      // window described above, since retries are spread out by the backoff below.
      const retryGuardError = attempt === 0 ? null : await validateWebhookUrl(target);
      if (retryGuardError) return { ok: false, error: retryGuardError };
      try {
        const res = await fetch(target, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
        if (res.ok) return { ok: true };
        lastError = `Webhook responded with status ${res.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < MAX_ATTEMPTS - 1) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }
    return { ok: false, error: lastError };
  }

  async sendTest(tenantId: string, target: string): Promise<NotifyResult> {
    const guardError = await validateWebhookUrl(target);
    if (guardError) return { ok: false, error: guardError };

    const config = await this.getConfig(tenantId);
    const body = JSON.stringify({ test: true, message: "Argus test webhook", sentAt: new Date().toISOString() });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config?.secret) headers["X-Argus-Signature"] = `sha256=${this.sign(body, config.secret)}`;

    try {
      const res = await fetch(target, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ok: false, error: `Webhook responded with status ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

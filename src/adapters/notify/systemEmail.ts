// Transactional/system email (user invites, password resets, scheduled digests) — kept separate
// from smtpNotifier.ts's SmtpNotifier, which is scoped to the Notifier port (alert payloads only)
// and shouldn't grow an arbitrary-subject/body method just for this. Reuses the exact same
// stored-SMTP-config shape and decryption as the notifier registry. Takes the settings repo and
// instance key directly (not the full AppContainer) so it can be wrapped in a SystemEmailSender
// port adapter — see registry.ts's DefaultSystemEmailSender — without a circular dependency on the
// container it's itself a field of.
import nodemailer from "nodemailer";
import { networkInterfaces } from "node:os";
import type { SettingsRepo } from "@ports/repos";
import type { SystemEmailResult, SystemEmailSender } from "@ports/services";
import { decryptSecret } from "@adapters/crypto";
import { SMTP_SETTINGS_KEY, type StoredSmtpConfig } from "@adapters/notify/registry";

/** `SystemEmailSender` port implementation — binds the settings repo + instance key once at
 * construction (mirroring DefaultNotifierRegistry's pattern) so callers just do `app.systemEmail.send(...)`. */
export class DefaultSystemEmailSender implements SystemEmailSender {
  constructor(
    private settings: SettingsRepo,
    private instanceKey: Buffer
  ) {}

  send(tenantId: string, opts: { to: string; subject: string; text: string; html: string }): Promise<SystemEmailResult> {
    return sendSystemEmail(this.settings, this.instanceKey, tenantId, opts);
  }
}

export async function sendSystemEmail(
  settings: SettingsRepo,
  instanceKey: Buffer,
  tenantId: string,
  opts: { to: string; subject: string; text: string; html: string }
): Promise<SystemEmailResult> {
  const raw = await settings.get(tenantId, SMTP_SETTINGS_KEY);
  if (!raw) return { ok: false, error: "SMTP is not configured (Settings → Notifications)" };

  let stored: StoredSmtpConfig;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { ok: false, error: "SMTP settings are corrupted — re-save them in Settings → Notifications" };
  }

  const { passEnc, ...rest } = stored;
  const config = { ...rest, pass: passEnc ? decryptSecret(instanceKey, passEnc) : undefined };

  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
    await transport.sendMail({ from: config.from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Best-effort LAN-reachable URL for this instance, for links in emails sent to other machines —
 * "http://localhost:PORT" only resolves on the machine actually running Argus. Falls back to
 * localhost if no non-internal IPv4 interface is found (e.g. genuinely offline). */
export function getLanUrl(port: number): string {
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return `http://${addr.address}:${port}`;
    }
  }
  return `http://localhost:${port}`;
}

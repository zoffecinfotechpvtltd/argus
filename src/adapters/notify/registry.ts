import type { Notifier, NotifierRegistry } from "@ports/services";
import type { NotificationChannel } from "@domain/entities";
import type { SettingsRepo } from "@ports/repos";
import { decryptSecret } from "@adapters/crypto";
import { SmtpNotifier, type SmtpConfig } from "@adapters/notify/smtpNotifier";
import { WebhookNotifier, type WebhookConfig } from "@adapters/notify/webhookNotifier";
import { SlackNotifier } from "@adapters/notify/slackNotifier";
import { TeamsNotifier } from "@adapters/notify/teamsNotifier";
import { PagerDutyNotifier } from "@adapters/notify/pagerdutyNotifier";

export const SMTP_SETTINGS_KEY = "notify.smtp";
export const WEBHOOK_SETTINGS_KEY = "notify.webhook";

/** On-disk shape for the SMTP settings blob — password is encrypted at rest, never stored plain. */
export interface StoredSmtpConfig extends Omit<SmtpConfig, "pass"> {
  passEnc?: string;
}

async function readJsonSetting<T>(settings: SettingsRepo, tenantId: string, key: string): Promise<T | null> {
  const raw = await settings.get(tenantId, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class DefaultNotifierRegistry implements NotifierRegistry {
  private notifiers: Record<NotificationChannel, Notifier>;

  constructor(settings: SettingsRepo, baseUrl: string, instanceKey: Buffer) {
    this.notifiers = {
      email: new SmtpNotifier(async (tenantId) => {
        const stored = await readJsonSetting<StoredSmtpConfig>(settings, tenantId, SMTP_SETTINGS_KEY);
        if (!stored) return null;
        const { passEnc, ...rest } = stored;
        return { ...rest, pass: passEnc ? decryptSecret(instanceKey, passEnc) : undefined };
      }, baseUrl),
      webhook: new WebhookNotifier((tenantId) => readJsonSetting<WebhookConfig>(settings, tenantId, WEBHOOK_SETTINGS_KEY)),
      slack: new SlackNotifier(),
      teams: new TeamsNotifier(),
      pagerduty: new PagerDutyNotifier(),
    };
  }

  get(channel: NotificationChannel): Notifier {
    return this.notifiers[channel];
  }
}

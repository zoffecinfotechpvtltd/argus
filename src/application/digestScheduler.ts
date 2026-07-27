import { DEFAULT_TENANT_ID } from "@domain/entities";
import { buildDigestEmail } from "@application/digestEmail";
import type { AppContainer } from "@ports/context";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECURRENCE_MS: Record<string, number> = { daily: DAY_MS, weekly: 7 * DAY_MS };

export const REPORTS_SCHEDULE_KEY = "reports.schedule";

export interface ScheduledReportConfig {
  enabled: boolean;
  recipients: string[];
  recurrence: "daily" | "weekly";
  lastSentAt: string | null;
}

function digestLastSentKey(userId: string): string {
  return `digest.lastSent.${userId}`;
}

function isDue(lastSentIso: string | null, recurrence: string, nowMs: number): boolean {
  if (!lastSentIso) return true;
  const periodMs = RECURRENCE_MS[recurrence];
  if (!periodMs) return false;
  return nowMs - new Date(lastSentIso).getTime() >= periodMs;
}

/** Runs hourly (fine-grained enough to catch daily/weekly cadences without drifting): sends the
 * per-user opt-in digest to anyone whose digestRecurrence has come due, and separately the
 * admin-configured instance-wide scheduled report if one is enabled and due. Both reuse the same
 * `buildDigestEmail` content — they differ only in recipients and where "due" is tracked. */
export async function runDigestCycle(app: AppContainer): Promise<void> {
  const nowMs = app.clock.now().getTime();

  const prefsWithDigest = await app.repos.notificationPrefs.listWithDigest();
  for (const prefs of prefsWithDigest) {
    if (!prefs.digestRecurrence) continue;
    const lastSent = await app.repos.settings.get(prefs.tenantId, digestLastSentKey(prefs.userId));
    if (!isDue(lastSent, prefs.digestRecurrence, nowMs)) continue;

    const user = await app.repos.user.findById(prefs.tenantId, prefs.userId);
    if (!user || user.disabled) continue;

    try {
      const email = await buildDigestEmail(app, prefs.digestRecurrence === "daily" ? 1 : 7);
      await app.systemEmail.send(prefs.tenantId, { to: user.email, ...email });
      await app.repos.settings.set(prefs.tenantId, digestLastSentKey(prefs.userId), app.clock.nowIso());
    } catch (err) {
      app.logger.error("personal_digest_failed", { userId: prefs.userId, error: (err as Error).message });
    }
  }

  try {
    const raw = await app.repos.settings.get(DEFAULT_TENANT_ID, REPORTS_SCHEDULE_KEY);
    if (!raw) return;
    const config = JSON.parse(raw) as ScheduledReportConfig;
    if (!config.enabled || config.recipients.length === 0) return;
    if (!isDue(config.lastSentAt, config.recurrence, nowMs)) return;

    const email = await buildDigestEmail(app, config.recurrence === "daily" ? 1 : 7);
    for (const to of config.recipients) {
      await app.systemEmail.send(DEFAULT_TENANT_ID, { to, ...email });
    }
    await app.repos.settings.set(
      DEFAULT_TENANT_ID,
      REPORTS_SCHEDULE_KEY,
      JSON.stringify({ ...config, lastSentAt: app.clock.nowIso() })
    );
  } catch (err) {
    app.logger.error("scheduled_report_failed", { error: (err as Error).message });
  }
}

export class DigestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private app: AppContainer) {}

  start(): void {
    this.timer = setInterval(() => {
      runDigestCycle(this.app).catch((err) => this.app.logger.error("digest_cycle_failed", { error: (err as Error).message }));
    }, HOUR_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

import { DEFAULT_TENANT_ID } from "@domain/entities";
import type { AppContainer } from "@ports/context";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Rolls the previous full hour of raw metrics into metrics_hourly, then prunes anything past the
 * configured retention windows. Runs low-priority/hourly — never blocks the scheduler tick loop.
 */
export async function runRetentionCycle(app: AppContainer): Promise<void> {
  const now = app.clock.now();
  const currentHourStart = new Date(now);
  currentHourStart.setUTCMinutes(0, 0, 0);
  const prevHourIso = new Date(currentHourStart.getTime() - HOUR_MS).toISOString();

  try {
    const rolled = await app.repos.metric.rollupHour(DEFAULT_TENANT_ID, prevHourIso);
    app.logger.info("retention_rollup", { hour: prevHourIso, rows: rolled });
  } catch (err) {
    app.logger.error("retention_rollup_failed", { error: (err as Error).message });
  }

  const rawCutoff = new Date(now.getTime() - app.config.retention.rawDays * DAY_MS).toISOString();
  const rollupCutoff = new Date(now.getTime() - app.config.retention.rollupDays * DAY_MS).toISOString();
  try {
    const deletedRaw = await app.repos.metric.deleteRawOlderThan(rawCutoff);
    const deletedRollups = await app.repos.metric.deleteRollupsOlderThan(rollupCutoff);
    app.logger.info("retention_cleanup", { deletedRaw, deletedRollups });
  } catch (err) {
    app.logger.error("retention_cleanup_failed", { error: (err as Error).message });
  }
}

export class RetentionScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private app: AppContainer) {}

  start(): void {
    this.timer = setInterval(() => {
      runRetentionCycle(this.app).catch((err) => this.app.logger.error("retention_cycle_failed", { error: (err as Error).message }));
    }, HOUR_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

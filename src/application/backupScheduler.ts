import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TENANT_ID } from "@domain/entities";
import { createBackupZip } from "@application/backup";
import type { AppContainer } from "@ports/context";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECURRENCE_MS: Record<string, number> = { daily: DAY_MS, weekly: 7 * DAY_MS };

export const BACKUP_SCHEDULE_KEY = "backup.schedule";

export interface BackupScheduleConfig {
  enabled: boolean;
  recurrence: "daily" | "weekly";
  keepCount: number;
  lastRunAt: string | null;
}

function isDue(lastRunIso: string | null, recurrence: string, nowMs: number): boolean {
  if (!lastRunIso) return true;
  const periodMs = RECURRENCE_MS[recurrence];
  if (!periodMs) return false;
  return nowMs - new Date(lastRunIso).getTime() >= periodMs;
}

/** Writes a backup to `dataDir/backups/`, using the exact same archive-building code the manual
 * "Download" button uses, then prunes down to the configured `keepCount` (oldest-first) — this
 * doesn't give live failover, but it means the on-prem box failing outright no longer means losing
 * every bit of monitoring history with it, which is the actual risk worth closing without a full
 * HA rearchitecture. */
export async function runBackupCycle(app: AppContainer): Promise<void> {
  const raw = await app.repos.settings.get(DEFAULT_TENANT_ID, BACKUP_SCHEDULE_KEY);
  if (!raw) return;
  const config: BackupScheduleConfig = JSON.parse(raw);
  if (!config.enabled) return;

  const nowMs = app.clock.now().getTime();
  if (!isDue(config.lastRunAt, config.recurrence, nowMs)) return;

  const backupsDir = join(app.config.dataDir, "backups");
  try {
    mkdirSync(backupsDir, { recursive: true });
    const zip = createBackupZip(app);
    const path = join(backupsDir, `argus-backup-${Date.now()}.zip`);
    writeFileSync(path, zip);

    const files = readdirSync(backupsDir)
      .filter((f) => f.startsWith("argus-backup-") && f.endsWith(".zip"))
      .map((f) => ({ name: f, mtime: statSync(join(backupsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(config.keepCount)) {
      rmSync(join(backupsDir, old.name), { force: true });
    }

    app.logger.info("scheduled_backup_created", { path, kept: Math.min(files.length, config.keepCount) });
  } catch (err) {
    app.logger.error("scheduled_backup_failed", { error: (err as Error).message });
    return; // don't advance lastRunAt on failure — retry next tick
  }

  await app.repos.settings.set(
    DEFAULT_TENANT_ID,
    BACKUP_SCHEDULE_KEY,
    JSON.stringify({ ...config, lastRunAt: app.clock.nowIso() })
  );
}

export class BackupScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private app: AppContainer) {}

  start(): void {
    this.timer = setInterval(() => {
      runBackupCycle(this.app).catch((err) => this.app.logger.error("backup_cycle_failed", { error: (err as Error).message }));
    }, HOUR_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

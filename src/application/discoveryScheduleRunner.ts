import { importDiscoveredDevices } from "@application/discovery/importDiscoveredDevices";
import type { AppContainer } from "@ports/context";
import type { DiscoverySchedule } from "@domain/entities";

const TICK_MS = 5 * 60 * 1000; // 5 minutes — fine-grained enough to catch daily/weekly cadences promptly
const DAY_MS = 24 * 60 * 60 * 1000;
const RECURRENCE_MS: Record<string, number> = { daily: DAY_MS, weekly: 7 * DAY_MS };

/** Runs every due scheduled discovery scan, then — unlike the manual Discovery page, which leaves
 * import as a deliberate human step — auto-imports every newly found device (already-known IPs are
 * silently skipped by `importDiscoveredDevices`, same as the manual flow) into the schedule's
 * configured target group. This is what actually makes "recurring discovery" useful unattended: a
 * scan whose results just sat in an in-memory job store nobody's watching would onboard nothing. */
export async function runDueDiscoverySchedules(app: AppContainer): Promise<void> {
  const nowIso = app.clock.nowIso();
  const due = await app.repos.discoverySchedule.listDue(nowIso);

  for (const schedule of due) {
    try {
      await runOneSchedule(app, schedule);
    } catch (err) {
      app.logger.error("discovery_schedule_run_failed", { scheduleId: schedule.id, error: (err as Error).message });
      const periodMs = RECURRENCE_MS[schedule.recurrence] ?? DAY_MS;
      await app.repos.discoverySchedule.update(schedule.tenantId, schedule.id, {
        lastRunAt: nowIso,
        nextRunAt: new Date(Date.now() + periodMs).toISOString(),
      });
    }
  }
}

async function runOneSchedule(app: AppContainer, schedule: DiscoverySchedule): Promise<void> {
  const snmpCommunity = schedule.snmpCredsEnc ? app.secretCipher.decrypt(schedule.snmpCredsEnc) : undefined;
  const results = await app.scanner.scan({ cidr: schedule.cidr, snmpCommunity, concurrency: app.config.polling.concurrency });

  const selections = results.map((d) => ({
    ip: d.ip,
    mac: d.mac,
    vendor: d.vendor,
    type: d.guessedType,
    openPorts: d.openPorts,
    name: d.hostname ?? undefined,
    groupId: schedule.targetGroupId,
    snmpCredsEnc: schedule.snmpCredsEnc && d.openPorts.includes(161) ? schedule.snmpCredsEnc : null,
  }));

  const importResult = selections.length > 0 ? await importDiscoveredDevices(app, schedule.tenantId, schedule.createdBy ?? "", selections) : { imported: [], skippedDuplicateIps: [] };

  await app.repos.audit.record({
    tenantId: schedule.tenantId,
    userId: null,
    action: "discovery.schedule_run",
    entityType: "discovery_schedule",
    entityId: schedule.id,
    detail: { cidr: schedule.cidr, found: results.length, imported: importResult.imported.length },
    createdAt: app.clock.nowIso(),
  });

  const periodMs = RECURRENCE_MS[schedule.recurrence] ?? DAY_MS;
  await app.repos.discoverySchedule.update(schedule.tenantId, schedule.id, {
    lastRunAt: app.clock.nowIso(),
    nextRunAt: new Date(Date.now() + periodMs).toISOString(),
  });
}

export class DiscoveryScheduleRunner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private app: AppContainer) {}

  start(): void {
    this.timer = setInterval(() => {
      runDueDiscoverySchedules(this.app).catch((err) => this.app.logger.error("discovery_schedule_cycle_failed", { error: (err as Error).message }));
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

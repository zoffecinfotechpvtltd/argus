import type { AppContainer } from "@ports/context";
import type { Check, Device, DeviceStatus, Metric } from "@domain/entities";
import type { StateTransitionRecord } from "@ports/services";
import { DEFAULT_POLICY, evaluateCheck, initialStatus, resolveThresholdOverrides } from "@domain/stateMachine";
import { aggregateCheckResults, type CheckRunResult } from "@domain/aggregateChecks";
import { isDeviceInMaintenance } from "@domain/maintenance";
import type { DomainEvent } from "@domain/events";
import { pollTierFor, tieredIntervalMs, type PollTier } from "@domain/pollTiers";

const TICK_MS = 1000;
const SHUTDOWN_GRACE_MS = 10_000;
const BACKLOG_WARN_MULTIPLIER = 2;
// M1 sharded-poller lease tuning: TTL comfortably exceeds the renewal interval (3x) so one or two
// missed renewals (GC pause, transient Redis blip) don't cause a false handoff, while still
// reassigning a genuinely dead poller's devices well inside the milestone's 60s test window.
const LEASE_TTL_MS = 15_000;
const LEASE_RENEW_MS = 5_000;
// How often a sharded poller re-lists the full device set. Device create/delete happens in the API
// process, a different process than the poller, so the in-process device.changed event (used below
// for the single-process/exe-mode path) can't reach it — periodic re-listing is the substitute.
const DEVICE_REFRESH_MS = 10_000;
// A failed check re-polls sooner than the device's normal interval instead of waiting out the
// full cycle — this confirms a real DOWN (and detects recovery) within a few seconds rather than
// full intervals, without touching failsToDown's consecutive-fail count (still needs failsToDown
// real failures in a row, so one blip doesn't page anyone).
const FAST_RETRY_MS = 5000;

interface ScheduleEntry {
  device: Device;
  checks: Check[];
  nextRunAt: number;
}

/** Adaptive-tier interval for `device`, based on the most recently known status (undefined -> "normal"). */
function nextInterval(intervalSec: number, status: DeviceStatus | undefined, nowMs: number): number {
  const tier: PollTier = status ? pollTierFor(status.state, status.since, nowMs) : "normal";
  return tieredIntervalMs(intervalSec, tier);
}

export class Scheduler {
  private app: AppContainer;
  private schedule = new Map<string, ScheduleEntry>();
  private statusCache = new Map<string, DeviceStatus>();
  private queue: string[] = [];
  private queuedSet = new Set<string>();
  private inFlight = 0;
  private activeRuns = new Set<Promise<void>>();
  private pendingStatus = new Map<string, DeviceStatus>();
  private pendingMetrics: Metric[] = [];
  private pendingTransitions: StateTransitionRecord[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private paused = false;
  private unsubscribe: (() => void) | null = null;
  private pollerId: string;
  // Only consulted when app.leaseCoordinator is set (sharded mode). Devices this process currently
  // holds the lease for — tick() skips everything else in `schedule`, even though `schedule` itself
  // holds every enabled device system-wide (needed so a lease can be attempted for any of them).
  private ownedDeviceIds = new Set<string>();
  private leaseTimer: ReturnType<typeof setInterval> | null = null;
  private deviceRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(app: AppContainer, opts?: { pollerId?: string }) {
    this.app = app;
    this.pollerId = opts?.pollerId ?? "local";
  }

  async start(): Promise<void> {
    const devices = await this.app.repos.device.listAllEnabled();
    for (const device of devices) {
      await this.loadDevice(device);
    }

    if (this.app.leaseCoordinator) {
      this.deviceRefreshTimer = setInterval(() => {
        this.refreshDevices().catch((err) => this.app.logger.error("scheduler_device_refresh_failed", { error: (err as Error).message }));
      }, DEVICE_REFRESH_MS);
      this.leaseTimer = setInterval(() => {
        this.leaseTick().catch((err) => this.app.logger.error("scheduler_lease_tick_failed", { error: (err as Error).message }));
      }, LEASE_RENEW_MS);
      await this.leaseTick();
    } else {
      this.unsubscribe = this.app.events.on<{ deviceId: string; tenantId: string; deleted?: boolean }>(
        "device.changed",
        (payload) => {
          this.onDeviceChanged(payload).catch((err) =>
            this.app.logger.error("scheduler_device_reload_failed", { deviceId: payload.deviceId, error: (err as Error).message })
          );
        }
      );
    }

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.app.logger.info("scheduler_started", {
      devices: devices.length,
      concurrency: this.app.config.polling.concurrency,
      sharded: !!this.app.leaseCoordinator,
      pollerId: this.app.leaseCoordinator ? this.pollerId : undefined,
    });
  }

  private async refreshDevices(): Promise<void> {
    const devices = await this.app.repos.device.listAllEnabled();
    const seen = new Set(devices.map((d) => d.id));
    for (const device of devices) {
      const existing = this.schedule.get(device.id);
      if (!existing) {
        await this.loadDevice(device);
        continue;
      }
      // A device/check edit made via the API (a different process than this poller) never reaches
      // us through the in-process device.changed event — refresh the cached device + checks here
      // instead, in place, without touching nextRunAt, so an edit takes effect within one refresh
      // cycle without disrupting the device's current poll timing.
      const checks = await this.app.repos.check.listByDevice(device.tenantId, device.id);
      existing.device = device;
      existing.checks = checks.filter((c) => c.enabled);
    }
    for (const deviceId of [...this.schedule.keys()]) {
      if (seen.has(deviceId)) continue;
      this.schedule.delete(deviceId);
      this.statusCache.delete(deviceId);
      if (this.ownedDeviceIds.delete(deviceId)) {
        await this.app.leaseCoordinator!.release(deviceId, this.pollerId).catch(() => {});
      }
    }
  }

  private async leaseTick(): Promise<void> {
    const lease = this.app.leaseCoordinator;
    if (!lease) return;
    await Promise.all(
      [...this.schedule.keys()].map(async (deviceId) => {
        if (this.ownedDeviceIds.has(deviceId)) {
          const stillOwned = await lease.renew(deviceId, this.pollerId, LEASE_TTL_MS);
          if (!stillOwned) {
            this.ownedDeviceIds.delete(deviceId);
            this.app.logger.info("poller_lease_lost", { deviceId, pollerId: this.pollerId });
          }
        } else {
          const acquired = await lease.acquire(deviceId, this.pollerId, LEASE_TTL_MS);
          if (acquired) {
            this.ownedDeviceIds.add(deviceId);
            this.app.logger.info("poller_lease_acquired", { deviceId, pollerId: this.pollerId });
          }
        }
      })
    );
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    if (this.deviceRefreshTimer) clearInterval(this.deviceRefreshTimer);
    this.unsubscribe?.();

    const drain = Promise.allSettled([...this.activeRuns]);
    await Promise.race([drain, new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))]);

    await this.flush();

    // Graceful hand-off: release owned leases immediately on a clean stop rather than making the
    // next owner wait out the full TTL. An ungraceful kill (M1's actual test) skips this — that
    // case relies on TTL expiry + another poller's next lease-tick, both well inside 60s.
    if (this.app.leaseCoordinator) {
      await Promise.all([...this.ownedDeviceIds].map((id) => this.app.leaseCoordinator!.release(id, this.pollerId).catch(() => {})));
    }

    this.app.logger.info("scheduler_stopped");
  }

  private async loadDevice(device: Device): Promise<void> {
    const checks = await this.app.repos.check.listByDevice(device.tenantId, device.id);
    const enabledChecks = checks.filter((c) => c.enabled);

    let status = this.statusCache.get(device.id) ?? (await this.app.repos.status.findByDeviceId(device.tenantId, device.id));
    if (!status) status = initialStatus(device.id, device.tenantId, this.app.clock.nowIso());
    this.statusCache.set(device.id, status);

    this.schedule.set(device.id, {
      device,
      checks: enabledChecks,
      nextRunAt: Date.now() + nextInterval(device.intervalSec, status, Date.now()),
    });
  }

  private async onDeviceChanged(payload: { deviceId: string; tenantId: string; deleted?: boolean }): Promise<void> {
    if (payload.deleted) {
      this.schedule.delete(payload.deviceId);
      this.statusCache.delete(payload.deviceId);
      return;
    }
    const device = await this.app.repos.device.findById(payload.tenantId, payload.deviceId);
    if (!device || !device.enabled) {
      this.schedule.delete(payload.deviceId);
      return;
    }
    await this.loadDevice(device);
  }

  private lastTickAt = Date.now();

  getLastTickAt(): number {
    return this.lastTickAt;
  }

  /** Stops scheduling new checks (in-flight ones finish normally); used by tray/CLI "Pause monitoring". */
  pause(): void {
    this.paused = true;
    this.app.logger.info("scheduler_paused");
  }

  resume(): void {
    this.paused = false;
    this.app.logger.info("scheduler_resumed");
  }

  isPaused(): boolean {
    return this.paused;
  }

  private tick(): void {
    if (this.stopping || this.paused) return;
    const now = Date.now();
    this.lastTickAt = now;

    for (const [deviceId, entry] of this.schedule) {
      if (this.app.leaseCoordinator && !this.ownedDeviceIds.has(deviceId)) continue;
      if (entry.nextRunAt <= now && !this.queuedSet.has(deviceId) && !this.isRunning(deviceId)) {
        entry.nextRunAt = now + nextInterval(entry.device.intervalSec, this.statusCache.get(deviceId), now);
        this.queue.push(deviceId);
        this.queuedSet.add(deviceId);
      }
    }

    this.drainQueue();

    const backlogThreshold = this.app.config.polling.concurrency * BACKLOG_WARN_MULTIPLIER;
    if (this.queue.length > backlogThreshold) {
      this.app.logger.warn("scheduler_backlog", { queueLength: this.queue.length, concurrency: this.app.config.polling.concurrency });
    }

    this.flush().catch((err) => this.app.logger.error("scheduler_flush_failed", { error: (err as Error).message }));
  }

  private runningIds = new Set<string>();
  private isRunning(deviceId: string): boolean {
    return this.runningIds.has(deviceId);
  }

  private drainQueue(): void {
    while (this.inFlight < this.app.config.polling.concurrency && this.queue.length > 0) {
      const deviceId = this.queue.shift()!;
      this.queuedSet.delete(deviceId);
      const entry = this.schedule.get(deviceId);
      if (!entry) continue;

      this.inFlight++;
      this.runningIds.add(deviceId);
      const p = this.runDevice(entry)
        .catch((err) => this.app.logger.error("device_check_failed", { deviceId, error: (err as Error).message }))
        .finally(() => {
          this.inFlight--;
          this.runningIds.delete(deviceId);
          this.activeRuns.delete(p);
          if (!this.stopping) this.drainQueue();
        });
      this.activeRuns.add(p);
    }
  }

  private async runDevice(entry: ScheduleEntry): Promise<void> {
    const { device, checks } = entry;
    const nowIso = this.app.clock.nowIso();

    const activeWindows = await this.app.repos.maintenance.listActive(device.tenantId, nowIso);
    const inMaintenance = isDeviceInMaintenance(activeWindows, device.id, device.groupId, nowIso);

    const results: CheckRunResult[] = [];
    for (const check of checks) {
      const checker = this.app.checkers.get(check.kind);
      const result = await checker.run(device, check);
      results.push({ kind: check.kind, result });

      if (result.values) {
        for (const [name, value] of Object.entries(result.values)) {
          this.pendingMetrics.push({ tenantId: device.tenantId, deviceId: device.id, checkId: check.id, ts: nowIso, name, value });
        }
      }
      if (result.latencyMs !== undefined) {
        this.pendingMetrics.push({
          tenantId: device.tenantId,
          deviceId: device.id,
          checkId: check.id,
          ts: nowIso,
          name: `${check.kind}.latencyMs`,
          value: result.latencyMs,
        });
      }
    }

    const outcome = aggregateCheckResults(results);
    if (!outcome.ok) {
      entry.nextRunAt = Date.now() + Math.min(FAST_RETRY_MS, device.intervalSec * 1000);
    }
    const currentStatus = this.statusCache.get(device.id) ?? initialStatus(device.id, device.tenantId, nowIso);
    const policy = { ...DEFAULT_POLICY, thresholds: { ...DEFAULT_POLICY.thresholds, ...resolveThresholdOverrides(checks) } };

    const { status: newStatus, events } = evaluateCheck(currentStatus, outcome, policy, nowIso, inMaintenance);

    const stateChanged = newStatus.state !== currentStatus.state;
    this.statusCache.set(device.id, newStatus);
    this.pendingStatus.set(device.id, newStatus);

    for (const event of events) {
      this.app.events.emit<DomainEvent>("monitoring.event", event);
    }
    if (stateChanged) {
      this.app.events.emit("device.status_changed", {
        deviceId: device.id,
        tenantId: device.tenantId,
        state: newStatus.state,
        since: newStatus.since,
        latencyMs: newStatus.lastLatencyMs,
      });
      this.pendingTransitions.push({ tenantId: device.tenantId, deviceId: device.id, newState: newStatus.state, atIso: nowIso });
    }
  }

  private async flush(): Promise<void> {
    if (this.pendingStatus.size === 0 && this.pendingMetrics.length === 0 && this.pendingTransitions.length === 0) return;
    const statusUpdates = [...this.pendingStatus.values()];
    const metrics = this.pendingMetrics;
    const transitions = this.pendingTransitions;
    this.pendingTransitions = [];
    this.pendingStatus = new Map();
    this.pendingMetrics = [];
    await this.app.tickPersister.persist(statusUpdates, metrics, transitions);
  }

  getScheduledDeviceCount(): number {
    return this.schedule.size;
  }

  /** Devices this process currently leases (sharded mode only — equals getScheduledDeviceCount() when unsharded). */
  getOwnedDeviceCount(): number {
    return this.app.leaseCoordinator ? this.ownedDeviceIds.size : this.schedule.size;
  }

  /** M5 introspection — which adaptive tier a device is currently in, or undefined if unscheduled. */
  getPollTier(deviceId: string): PollTier | undefined {
    const status = this.statusCache.get(deviceId);
    if (!status) return undefined;
    return pollTierFor(status.state, status.since, Date.now());
  }
}

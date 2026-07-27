import type { AppContainer } from "@ports/context";
import type { Alert, Device } from "@domain/entities";
import { notifyUser, buildAckUrl } from "@application/notifyRouting";
import { shouldSuppressForUplink } from "@domain/dependencySuppression";
import { getOnCallUserId } from "@domain/onCall";

const ESCALATION_INTERVAL_MS = 60_000;

/**
 * Advances one alert's escalation state. Step 0 always notifies the device's responsible user
 * (if any) immediately. Steps 1..N map to the device's group escalation chain entries in order —
 * chain[0] is step 1, chain[1] is step 2, etc. — each fired once `afterMinutes` has elapsed since
 * the alert opened. No-op for alerts that are acknowledged or resolved.
 *
 * Uplink suppression lives here (not just at initial-alert-creation time) because this function
 * has two independent callers — AlertEngine's own initial-notify path, and EscalationWorker's
 * periodic tick over every open unacked alert — and a check that only ran at alert-creation time
 * would get silently bypassed by the periodic tick the next time it ran. Checking fresh on every
 * call, right before the step-0 notify, means suppression holds for as long as the uplink is down
 * and self-corrects (no separate "wake the suppressed dependents" step needed) the moment either
 * caller runs again after the uplink recovers.
 */
export async function processEscalationForAlert(app: AppContainer, alert: Alert, device: Device): Promise<Alert> {
  if (alert.status !== "open") return alert;

  if (device.uplinkDeviceId) {
    const uplinkStatus = await app.repos.status.findByDeviceId(device.tenantId, device.uplinkDeviceId);
    if (shouldSuppressForUplink(uplinkStatus?.state ?? null)) return alert;
  }

  const now = app.clock.now();
  const elapsedMin = (now.getTime() - new Date(alert.openedAt).getTime()) / 60_000;
  const group = device.groupId ? await app.repos.group.findById(device.tenantId, device.groupId) : null;
  const chain = group?.escalationChain ?? [];
  const ackUrl = buildAckUrl(app, alert.id);

  // M4: a chain step can target "whoever's on call" instead of a fixed user — resolved fresh every
  // time this runs (not cached), same reasoning as the uplink-suppression check above: the on-call
  // person can rotate mid-outage, and the next tick should page whoever is actually on call now,
  // not whoever was on call when the alert first opened. Only fetched if at least one step needs
  // it (most tenants won't use on-call schedules at all).
  const needsOnCall = chain.some((s) => s.onCall);
  const onCallSchedule = needsOnCall && group ? await app.repos.onCallSchedule.findByGroup(device.tenantId, group.id) : null;
  const resolveTarget = (s: (typeof chain)[number]): string | null =>
    s.onCall ? (onCallSchedule ? getOnCallUserId(onCallSchedule, now.toISOString()) : null) : (s.userId ?? null);

  // Each step transition is claimed atomically (conditional UPDATE — only succeeds if the step in
  // the DB still matches what we read) before notifying, not notified-then-recorded. AlertEngine's
  // own initial-notify path and EscalationWorker's independent periodic tick both call this
  // function on the same open alerts with no other coordination between them; a plain
  // read-then-write here would let both see the same starting step and both notify for it —
  // exactly the double-notification this guards against.
  let current = alert;

  if (current.escalationStep === 0) {
    if (await app.repos.alert.claimEscalationStep(device.tenantId, current.id, 0, 1)) {
      if (device.responsibleUserId) await notifyUser(app, device.responsibleUserId, current, device, ackUrl);
      current = { ...current, escalationStep: 1 };
    } else {
      // Lost the race — the other caller already claimed step 0. Re-fetch so the chain loop below
      // starts from the real current step instead of assuming 1.
      current = (await app.repos.alert.findById(device.tenantId, current.id)) ?? current;
    }
  }

  while (current.escalationStep - 1 < chain.length && chain[current.escalationStep - 1]!.afterMinutes <= elapsedMin) {
    const step = current.escalationStep;
    if (!(await app.repos.alert.claimEscalationStep(device.tenantId, current.id, step, step + 1))) {
      current = (await app.repos.alert.findById(device.tenantId, current.id)) ?? current;
      break; // another caller is racing us on this alert — stop rather than risk double-claiming a later step too
    }
    const target = resolveTarget(chain[step - 1]!);
    if (target) await notifyUser(app, target, current, device, ackUrl);
    current = { ...current, escalationStep: step + 1 };
  }

  return current;
}

export class EscalationWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private app: AppContainer,
    private intervalMs = ESCALATION_INTERVAL_MS
  ) {}

  start(): void {
    // M4 durability test: a process restart must resume in-flight escalations, not lose them or
    // wait out a full interval before checking. Nothing to "resume" in the sense of restoring
    // in-memory timers — escalation state is fully persisted (alert.escalationStep + openedAt),
    // so a restart just needs to re-read it promptly; running once immediately (not waiting for
    // the first setInterval tick) is what makes that prompt rather than up-to-intervalMs delayed.
    this.runOnce().catch((err) => this.app.logger.error("escalation_cycle_failed", { error: (err as Error).message }));
    this.timer = setInterval(() => {
      this.runOnce().catch((err) => this.app.logger.error("escalation_cycle_failed", { error: (err as Error).message }));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    const openAlerts = await this.app.repos.alert.listOpenUnacked();
    for (const alert of openAlerts) {
      const device = await this.app.repos.device.findById(alert.tenantId, alert.deviceId);
      if (!device) continue;
      await processEscalationForAlert(this.app, alert, device);
    }
  }
}

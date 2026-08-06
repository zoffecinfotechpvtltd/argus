import { randomUUID } from "node:crypto";
import type { AppContainer } from "@ports/context";
import type { Alert, Device } from "@domain/entities";
import type { DomainEvent } from "@domain/events";
import { conditionKeyForEvent, severityForEvent, titleForEvent } from "@domain/alertRules";
import { isRateLimited, isStorm, mostCommonGroupId } from "@domain/antiNoise";
import { notifyUser, buildAckUrl } from "@application/notifyRouting";
import { processEscalationForAlert } from "@application/escalation";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 4;
const STORM_THRESHOLD = 20;

export interface AlertEngineOptions {
  stormWindowMs?: number;
}

export class AlertEngine {
  private unsubscribe: (() => void) | null = null;
  private sentTimestamps = new Map<string, number[]>(); // deviceId -> notification send times
  private summaryLastSentAt = new Map<string, number>(); // deviceId -> last summary send time
  private downBuffer: Array<{ device: Device; alert: Alert }> = [];
  private downBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stormWindowMs: number;

  constructor(
    private app: AppContainer,
    opts: AlertEngineOptions = {}
  ) {
    this.stormWindowMs = opts.stormWindowMs ?? 60_000;
  }

  start(): void {
    this.unsubscribe = this.app.events.on<DomainEvent>("monitoring.event", (event) => {
      this.handleEvent(event).catch((err) => this.app.logger.error("alert_engine_event_failed", { error: (err as Error).message, event }));
    });
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.downBufferTimer) clearTimeout(this.downBufferTimer);
  }

  private async handleEvent(event: DomainEvent): Promise<void> {
    const resolved = await this.app.repos.device.findById(event.tenantId, event.deviceId);
    if (!resolved) return;

    if (event.type === "DeviceRecovered") {
      await this.handleRecovery(resolved, event.at);
      return;
    }

    const conditionKey = conditionKeyForEvent(event);
    const existing = await this.app.repos.alert.findOpenByCondition(resolved.tenantId, resolved.id, conditionKey);

    if (existing) {
      await this.app.repos.alert.update(resolved.tenantId, existing.id, { lastSeenAt: event.at });
      if (event.type === "DeviceWentDown") {
        // Repeat DOWN pulses for an already-open down alert don't re-enter the storm buffer.
      }
      return;
    }

    const now = event.at;
    const alert: Alert = {
      id: randomUUID(),
      tenantId: resolved.tenantId,
      deviceId: resolved.id,
      conditionKey,
      severity: severityForEvent(event),
      status: "open",
      title: titleForEvent(event, resolved.name),
      detail: event.type === "ThresholdBreached" ? `${event.metric}=${event.value} (limit ${event.limit})` : null,
      openedAt: now,
      lastSeenAt: now,
      ackedBy: null,
      ackedAt: null,
      resolvedAt: null,
      escalationStep: 0,
    };
    const created = await this.app.repos.alert.create(alert);

    await this.app.repos.audit.record({
      tenantId: resolved.tenantId,
      userId: null,
      action: "alert.open",
      entityType: "alert",
      entityId: created.id,
      detail: { deviceId: resolved.id, conditionKey, severity: created.severity },
      createdAt: now,
    });
    this.app.events.emit("alert.changed", { alertId: created.id, tenantId: resolved.tenantId, status: created.status });
    await this.app.syslogForwarder.forward(resolved.tenantId, created, resolved.name);

    // Uplink suppression (device.uplinkDeviceId currently down) is checked inside
    // processEscalationForAlert itself (application/escalation.ts), not here — see that function's
    // doc comment for why centralizing it there instead of gating entry to bufferDownAlert/
    // routeInitialNotification is what makes it hold for the whole outage, not just this first call.
    if (event.type === "DeviceWentDown" && !resolved.criticalAsset) {
      this.bufferDownAlert(resolved, created);
    } else {
      // Critical assets (cameras, firewalls, anything flagged criticalAsset) skip the storm buffer
      // entirely — their own downtime is always actionable on its own, independent of whether a
      // wider outage is also happening, so waiting stormWindowMs to find out isn't acceptable.
      await this.routeInitialNotification(resolved, created);
    }
  }

  private async handleRecovery(device: Device, atIso: string): Promise<void> {
    const openPage = await this.app.repos.alert.list(device.tenantId, { deviceId: device.id, status: "open" });
    for (const alert of openPage.items) {
      const resolved = await this.app.repos.alert.update(device.tenantId, alert.id, { status: "resolved", resolvedAt: atIso });
      if (!resolved) continue;

      await this.app.repos.audit.record({
        tenantId: device.tenantId,
        userId: null,
        action: "alert.resolve",
        entityType: "alert",
        entityId: alert.id,
        detail: { auto: true },
        createdAt: atIso,
      });
      this.app.events.emit("alert.changed", { alertId: alert.id, tenantId: device.tenantId, status: "resolved" });

      if (device.responsibleUserId) {
        const recoveryAlert: Alert = { ...resolved, title: `${device.name} has recovered`, severity: "info" };
        await notifyUser(this.app, device.responsibleUserId, recoveryAlert, device);
      }
    }

    // No explicit "wake the suppressed dependents" step needed: processEscalationForAlert
    // (application/escalation.ts) checks the uplink's live status on every call, including
    // EscalationWorker's own periodic tick over every open unacked alert — so a dependent's
    // withheld notification fires on its own within one escalation tick of the uplink recovering,
    // not because this recovery handler reached out and found it.
  }

  private bufferDownAlert(device: Device, alert: Alert): void {
    this.downBuffer.push({ device, alert });
    if (!this.downBufferTimer) {
      this.downBufferTimer = setTimeout(() => {
        this.flushDownBuffer().catch((err) => this.app.logger.error("down_buffer_flush_failed", { error: (err as Error).message }));
      }, this.stormWindowMs);
    }
  }

  private async flushDownBuffer(): Promise<void> {
    const batch = this.downBuffer;
    this.downBuffer = [];
    this.downBufferTimer = null;
    if (batch.length === 0) return;

    const nowMs = this.app.clock.now().getTime();
    const timestamps = batch.map(() => nowMs);

    if (isStorm(timestamps, nowMs, this.stormWindowMs, STORM_THRESHOLD)) {
      await this.sendStormNotification(batch);
      return;
    }

    for (const { device, alert } of batch) {
      await this.routeInitialNotification(device, alert);
    }
  }

  private async sendStormNotification(batch: Array<{ device: Device; alert: Alert }>): Promise<void> {
    const tenantId = batch[0]!.device.tenantId;
    const groupId = mostCommonGroupId(batch.map((b) => b.device.groupId));
    const groupName = groupId ? (await this.app.repos.group.findById(tenantId, groupId))?.name ?? null : null;
    // Every device this storm caught, by name — not just a count. This is what actually lets the
    // on-call person work the incident: aggregating into one notification (instead of N separate
    // emails) must never cost them knowing exactly which devices are down, especially since a
    // storm this size is often one shared upstream link (a site's VPN tunnel, a core switch) taking
    // a whole group down at once rather than N unrelated failures.
    const affectedDevices = batch.map((b) => ({ name: b.device.name, ip: b.device.ip }));

    const summaryAlert: Alert = {
      id: randomUUID(),
      tenantId,
      deviceId: batch[0]!.device.id,
      conditionKey: "storm",
      severity: "critical",
      status: "open",
      title: `Possible upstream outage: ${batch.length} devices down${groupName ? `, top common group: ${groupName}` : ""}`,
      detail: `Affected devices: ${affectedDevices.map((d) => `${d.name} (${d.ip})`).join(", ")}`,
      openedAt: this.app.clock.nowIso(),
      lastSeenAt: this.app.clock.nowIso(),
      ackedBy: null,
      ackedAt: null,
      resolvedAt: null,
      escalationStep: 0,
    };

    const admins = (await this.app.repos.user.list(tenantId)).filter((u) => u.role === "admin" && !u.disabled);
    for (const admin of admins) {
      await notifyUser(this.app, admin.id, summaryAlert, batch[0]!.device, undefined, affectedDevices);
    }

    await this.app.repos.audit.record({
      tenantId,
      userId: null,
      action: "alert.storm_guard",
      entityType: "alert",
      entityId: null,
      detail: { deviceCount: batch.length, groupId },
      createdAt: summaryAlert.openedAt,
    });
  }

  private async routeInitialNotification(device: Device, alert: Alert): Promise<void> {
    const nowMs = this.app.clock.now().getTime();
    const history = this.sentTimestamps.get(device.id) ?? [];

    // Critical assets always page — a flapping camera/firewall must not get throttled into a
    // once-an-hour summary the way a noisy ordinary device would.
    if (!device.criticalAsset && isRateLimited(history, nowMs, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)) {
      const lastSummary = this.summaryLastSentAt.get(device.id) ?? 0;
      if (nowMs - lastSummary > RATE_LIMIT_WINDOW_MS) {
        await this.sendRateLimitSummary(device, alert, history.length);
        this.summaryLastSentAt.set(device.id, nowMs);
      }
      return;
    }

    await processEscalationForAlert(this.app, alert, device); // handles step-0 responsible-user notify
    history.push(nowMs);
    this.sentTimestamps.set(device.id, history);
  }

  private async sendRateLimitSummary(device: Device, alert: Alert, countSoFar: number): Promise<void> {
    if (!device.responsibleUserId) return;
    const summaryAlert: Alert = {
      ...alert,
      title: `${device.name}: ${countSoFar}+ alerts in the last hour (rate-limited — showing a summary)`,
    };
    const ackUrl = buildAckUrl(this.app, alert.id);
    await notifyUser(this.app, device.responsibleUserId, summaryAlert, device, ackUrl);
  }
}

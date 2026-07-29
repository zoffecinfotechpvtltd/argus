import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { AlertEngine } from "@application/alertEngine";
import { EscalationWorker, processEscalationForAlert } from "@application/escalation";
import { acknowledgeAlert } from "@application/alertActions";
import { DEFAULT_TENANT_ID, type Device, type NotificationChannel } from "@domain/entities";
import type { AppContainer } from "@ports/context";
import type { Notifier, NotifierRegistry, NotifyPayload } from "@ports/services";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RecordedSend {
  channel: NotificationChannel;
  target: string;
  title: string;
  detail: string | null;
  affectedDevices?: Array<{ name: string; ip: string }>;
}

class RecordingNotifier implements Notifier {
  constructor(
    public channel: NotificationChannel,
    private calls: RecordedSend[]
  ) {}
  async send(target: string, payload: NotifyPayload) {
    this.calls.push({ channel: this.channel, target, title: payload.alert.title, detail: payload.alert.detail, affectedDevices: payload.affectedDevices });
    return { ok: true };
  }
  async sendTest() {
    return { ok: true };
  }
}

function makeRecordingRegistry(): { registry: NotifierRegistry; calls: RecordedSend[] } {
  const calls: RecordedSend[] = [];
  return { registry: { get: (channel) => new RecordingNotifier(channel, calls) }, calls };
}

async function seedUser(app: AppContainer, role: "admin" | "operator" | "viewer" = "operator") {
  const now = app.clock.nowIso();
  return app.repos.user.create({
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    email: `user-${randomUUID()}@test.local`,
    passwordHash: "x",
    role,
    forcePasswordReset: false,
    disabled: false,
    emailVerifiedAt: now,
    totpSecret: null,
    totpEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    onboardingCompletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedDevice(app: AppContainer, overrides: Partial<Device> = {}): Promise<Device> {
  const now = app.clock.nowIso();
  const device: Device = {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    name: "device",
    ip: "10.0.0.1",
    mac: null,
    vendor: null,
    type: "unknown",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: 60,
    enabled: true,
    snmpCredsEnc: null,
    tags: [],
    uplinkDeviceId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await app.repos.device.create(device);
  return device;
}

describe("AlertEngine — open/dedup/recover", () => {
  it("opens a CRITICAL alert on DeviceWentDown, notifies email, dedups repeats, and auto-resolves + notifies on recovery", async () => {
    const { registry, calls } = makeRecordingRegistry();
    const { app } = buildTestContainer({ notifiers: registry });
    const user = await seedUser(app);
    await app.repos.notificationPrefs.upsert({
      userId: user.id,
      tenantId: DEFAULT_TENANT_ID,
      channels: ["email"],
      severityFloor: "info",
      quietHoursStart: null,
      quietHoursEnd: null,
      webhookUrl: null,
      digestRecurrence: null,
    });
    const device = await seedDevice(app, { responsibleUserId: user.id });

    const engine = new AlertEngine(app, { stormWindowMs: 30 });
    engine.start();

    const at1 = app.clock.nowIso();
    app.events.emit("monitoring.event", { type: "DeviceWentDown", deviceId: device.id, tenantId: DEFAULT_TENANT_ID, at: at1 });
    await sleep(60); // let the down-buffer (30ms in this test) flush and notifications send

    const openPage = await app.repos.alert.list(DEFAULT_TENANT_ID, { status: "open" });
    expect(openPage.total).toBe(1);
    expect(openPage.items[0]?.severity).toBe("critical");
    expect(calls.some((c) => c.channel === "email" && c.target === user.email)).toBe(true);
    const sendsAfterFirstDown = calls.length;

    // Repeat DOWN event for the same device+condition must NOT open a second alert.
    app.events.emit("monitoring.event", { type: "DeviceWentDown", deviceId: device.id, tenantId: DEFAULT_TENANT_ID, at: app.clock.nowIso() });
    await sleep(60);
    const stillOpenPage = await app.repos.alert.list(DEFAULT_TENANT_ID, { status: "open" });
    expect(stillOpenPage.total).toBe(1); // no duplicate

    // Recovery auto-resolves and sends a recovery notice.
    app.events.emit("monitoring.event", { type: "DeviceRecovered", deviceId: device.id, tenantId: DEFAULT_TENANT_ID, at: app.clock.nowIso() });
    await sleep(20);
    const resolvedPage = await app.repos.alert.list(DEFAULT_TENANT_ID, { status: "resolved" });
    expect(resolvedPage.total).toBe(1);
    expect(calls.length).toBeGreaterThan(sendsAfterFirstDown); // a recovery notification went out

    engine.stop();
  });
});

describe("Escalation", () => {
  it("escalates at exactly +10min and +30min per the group's chain, and stops once acknowledged", async () => {
    const { app, clock } = buildTestContainer();
    const owner = await seedUser(app);
    const teamLead = await seedUser(app);
    const admin = await seedUser(app, "admin");

    const group = await app.repos.group.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      name: "core",
      escalationChain: [
        { userId: teamLead.id, afterMinutes: 10 },
        { userId: admin.id, afterMinutes: 30 },
      ],
      createdAt: app.clock.nowIso(),
      updatedAt: app.clock.nowIso(),
    });
    const device = await seedDevice(app, { responsibleUserId: owner.id, groupId: group.id });

    const now = app.clock.nowIso();
    let alert = await app.repos.alert.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      deviceId: device.id,
      conditionKey: "down",
      severity: "critical",
      status: "open",
      title: "down",
      detail: null,
      openedAt: now,
      lastSeenAt: now,
      ackedBy: null,
      ackedAt: null,
      resolvedAt: null,
      escalationStep: 0,
    });

    // t+0: step 0 -> notifies owner, advances to step 1.
    alert = await processEscalationForAlert(app, alert, device);
    expect(alert.escalationStep).toBe(1);

    // t+5min: chain[0] (10min) not due yet.
    clock.advance(5 * 60 * 1000);
    alert = await processEscalationForAlert(app, alert, device);
    expect(alert.escalationStep).toBe(1);

    // t+10min: chain[0] due -> notifies team lead, advances to step 2.
    clock.advance(5 * 60 * 1000);
    alert = await processEscalationForAlert(app, alert, device);
    expect(alert.escalationStep).toBe(2);

    // t+12min: ack — must stop further escalation.
    clock.advance(2 * 60 * 1000);
    const acked = await acknowledgeAlert(app, DEFAULT_TENANT_ID, alert.id, owner.id);
    expect(acked?.status).toBe("acknowledged");

    // t+30min: even though chain[1] (30min) would now be due, acknowledged alerts don't escalate further.
    clock.advance(18 * 60 * 1000);
    const afterAck = await processEscalationForAlert(app, acked!, device);
    expect(afterAck.escalationStep).toBe(2); // unchanged — chain stopped
  });

  it("EscalationWorker.runOnce processes all open unacked alerts in one pass", async () => {
    const { app } = buildTestContainer();
    const owner = await seedUser(app);
    const device = await seedDevice(app, { responsibleUserId: owner.id });
    const now = app.clock.nowIso();
    await app.repos.alert.create({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      deviceId: device.id,
      conditionKey: "down",
      severity: "critical",
      status: "open",
      title: "down",
      detail: null,
      openedAt: now,
      lastSeenAt: now,
      ackedBy: null,
      ackedAt: null,
      resolvedAt: null,
      escalationStep: 0,
    });

    const worker = new EscalationWorker(app);
    await worker.runOnce();

    const [alert] = (await app.repos.alert.list(DEFAULT_TENANT_ID, { status: "open" })).items;
    expect(alert?.escalationStep).toBe(1);
  });
});

describe("Ack token", () => {
  it("verifies a freshly signed token", () => {
    const { app } = buildTestContainer();
    const token = app.tokenSigner.signAckToken("alert-1", 60_000);
    expect(app.tokenSigner.verifyAckToken("alert-1", token)).toBe(true);
  });

  it("rejects a token for the wrong alert id", () => {
    const { app } = buildTestContainer();
    const token = app.tokenSigner.signAckToken("alert-1", 60_000);
    expect(app.tokenSigner.verifyAckToken("alert-2", token)).toBe(false);
  });

  it("rejects a tampered token", () => {
    const { app } = buildTestContainer();
    const token = app.tokenSigner.signAckToken("alert-1", 60_000);
    const tampered = token.slice(0, -2) + "zz";
    expect(app.tokenSigner.verifyAckToken("alert-1", tampered)).toBe(false);
  });

  it("rejects an expired token", () => {
    const { app } = buildTestContainer();
    const token = app.tokenSigner.signAckToken("alert-1", -1); // already expired
    expect(app.tokenSigner.verifyAckToken("alert-1", token)).toBe(false);
  });
});

describe("Storm guard", () => {
  it("sends exactly one aggregate notification for 25 simultaneous DOWNs instead of 25 individual ones", async () => {
    const { registry, calls } = makeRecordingRegistry();
    const { app } = buildTestContainer({ notifiers: registry });
    const admin = await seedUser(app, "admin");
    await app.repos.notificationPrefs.upsert({
      userId: admin.id,
      tenantId: DEFAULT_TENANT_ID,
      channels: ["email"],
      severityFloor: "info",
      quietHoursStart: null,
      quietHoursEnd: null,
      webhookUrl: null,
      digestRecurrence: null,
    });

    const devices: Device[] = [];
    for (let i = 0; i < 25; i++) {
      devices.push(await seedDevice(app, { name: `d${i}`, ip: `10.1.0.${i}` }));
    }

    const engine = new AlertEngine(app, { stormWindowMs: 50 });
    engine.start();

    for (const d of devices) {
      app.events.emit("monitoring.event", { type: "DeviceWentDown", deviceId: d.id, tenantId: DEFAULT_TENANT_ID, at: app.clock.nowIso() });
    }
    await sleep(150); // let the 50ms storm-aggregation buffer flush

    const stormEmails = calls.filter((c) => c.target === admin.email);
    expect(stormEmails.length).toBe(1);
    expect(stormEmails[0]?.title).toContain("25 devices down");

    // Aggregating into one notification must never cost knowing exactly which devices are down —
    // every one of the 25 must be individually named, not just a count.
    expect(stormEmails[0]?.affectedDevices?.length).toBe(25);
    for (const d of devices) {
      expect(stormEmails[0]?.affectedDevices?.some((a) => a.name === d.name && a.ip === d.ip)).toBe(true);
      expect(stormEmails[0]?.detail).toContain(d.name);
    }

    engine.stop();
  });

  it("sends 25 individual notifications when the count is at or below the threshold (no storm)", async () => {
    const { registry, calls } = makeRecordingRegistry();
    const { app } = buildTestContainer({ notifiers: registry });
    const owner = await seedUser(app);

    const devices: Device[] = [];
    for (let i = 0; i < 15; i++) {
      devices.push(await seedDevice(app, { name: `d${i}`, ip: `10.2.0.${i}`, responsibleUserId: owner.id }));
    }

    const engine = new AlertEngine(app, { stormWindowMs: 50 });
    engine.start();
    for (const d of devices) {
      app.events.emit("monitoring.event", { type: "DeviceWentDown", deviceId: d.id, tenantId: DEFAULT_TENANT_ID, at: app.clock.nowIso() });
    }
    await sleep(150);

    // 15 individual per-device notifications to the owner (below the >20 storm threshold).
    expect(calls.filter((c) => c.target === owner.email).length).toBe(15);
    engine.stop();
  });
});

describe("Rate limiting", () => {
  it("caps individual notifications at 4/hour per device and sends exactly one summary for the rest", async () => {
    const { registry, calls } = makeRecordingRegistry();
    const { app } = buildTestContainer({ notifiers: registry });
    const owner = await seedUser(app);
    const device = await seedDevice(app, { responsibleUserId: owner.id });

    const engine = new AlertEngine(app, { stormWindowMs: 10 });
    engine.start();

    // 10 flap episodes: each is its own DeviceFlapping event (a distinct condition per cycle would
    // normally dedup, so alternate it with recovery to force 10 fresh "flapping" alert opens).
    for (let i = 0; i < 10; i++) {
      app.events.emit("monitoring.event", { type: "DeviceFlapping", deviceId: device.id, tenantId: DEFAULT_TENANT_ID, at: app.clock.nowIso() });
      await sleep(5);
      app.events.emit("monitoring.event", { type: "DeviceRecovered", deviceId: device.id, tenantId: DEFAULT_TENANT_ID, at: app.clock.nowIso() });
      await sleep(5);
    }
    await sleep(50);

    const ownerCalls = calls.filter((c) => c.target === owner.email);
    // Recovery notifications aren't rate-limited (they go out directly on handleRecovery) — this
    // test only measures the flap-open notifications and the rate-limit summary path.
    const individualCalls = ownerCalls.filter((c) => c.title.includes("FLAPPING"));
    const summaryCalls = ownerCalls.filter((c) => c.title.includes("rate-limited"));

    expect(individualCalls.length).toBeLessThanOrEqual(4);
    expect(summaryCalls.length).toBe(1);

    engine.stop();
  });
});

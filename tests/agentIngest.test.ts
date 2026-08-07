import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { processAgentDeviceResults } from "@application/agentIngest";
import { DEFAULT_TENANT_ID, type Check, type Device, type RemoteAgent } from "@domain/entities";

async function seedDevice(app: ReturnType<typeof buildTestContainer>["app"], overrides: Partial<Device> = {}): Promise<Device> {
  const now = app.clock.nowIso();
  const device: Device = {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    name: "branch-switch",
    ip: "10.50.0.1",
    mac: null,
    vendor: null,
    type: "switch",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: 60,
    enabled: true,
    snmpCredsEnc: null,
    tags: [],
    uplinkDeviceId: null,
    criticalAsset: false,
    model: null,
    firmwareVersion: null,
    serialNumber: null,
    haRole: null,
    apiVendor: null,
    apiCredsEnc: null,
    remoteAgentId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await app.repos.device.create(device);
  return device;
}

async function seedCheck(app: ReturnType<typeof buildTestContainer>["app"], deviceId: string, kind: Check["kind"] = "icmp"): Promise<Check> {
  const check: Check = {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    deviceId,
    kind,
    config: {},
    thresholds: {},
    enabled: true,
    createdAt: app.clock.nowIso(),
  };
  await app.repos.check.create(check);
  return check;
}

async function seedAgent(app: ReturnType<typeof buildTestContainer>["app"]): Promise<RemoteAgent> {
  return app.repos.remoteAgent.create({
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    name: "branch-agent",
    tokenHash: "irrelevant-for-these-tests",
    tokenPrefix: randomUUID().slice(0, 12),
    createdAt: app.clock.nowIso(),
    lastSeenAt: null,
    revokedAt: null,
  });
}

describe("processAgentDeviceResults", () => {
  it("rejects a device that doesn't exist", async () => {
    const { app } = buildTestContainer();
    const agent = await seedAgent(app);
    const outcome = await processAgentDeviceResults(app, agent, "no-such-device", [{ checkId: "x", result: { ok: true } }]);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.status).toBe(404);
  });

  it("rejects a device not assigned to this agent — the ownership boundary", async () => {
    const { app } = buildTestContainer();
    const owningAgent = await seedAgent(app);
    const otherAgent = await seedAgent(app);
    const device = await seedDevice(app, { remoteAgentId: owningAgent.id });
    const check = await seedCheck(app, device.id);

    const outcome = await processAgentDeviceResults(app, otherAgent, device.id, [{ checkId: check.id, result: { ok: true } }]);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.status).toBe(403);
  });

  it("rejects a device that's never been assigned to any agent (still polled locally)", async () => {
    const { app } = buildTestContainer();
    const agent = await seedAgent(app);
    const device = await seedDevice(app, { remoteAgentId: null });
    const check = await seedCheck(app, device.id);

    const outcome = await processAgentDeviceResults(app, agent, device.id, [{ checkId: check.id, result: { ok: true } }]);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.status).toBe(403);
  });

  it("persists status and metrics, and emits a status_changed event on a real transition", async () => {
    const { app } = buildTestContainer();
    const agent = await seedAgent(app);
    const device = await seedDevice(app, { remoteAgentId: null });
    // Assign after creation, same as the real edit flow — remoteAgentId isn't set at seedDevice
    // time above so this also exercises the update path, not just a hardcoded field.
    await app.repos.device.update(device.tenantId, device.id, { remoteAgentId: agent.id });
    const check = await seedCheck(app, device.id, "icmp");

    let sawStatusChanged = false;
    app.events.on("device.status_changed", () => {
      sawStatusChanged = true;
    });

    // failsToDown defaults to 3 — three consecutive failures are needed to actually flip state.
    for (let i = 0; i < 3; i++) {
      await processAgentDeviceResults(app, agent, device.id, [{ checkId: check.id, result: { ok: false, error: "timeout" } }]);
    }

    const status = await app.repos.status.findByDeviceId(device.tenantId, device.id);
    expect(status?.state).toBe("down");
    expect(sawStatusChanged).toBe(true);

    const updatedCheck = await app.repos.check.findById(device.tenantId, check.id);
    expect(updatedCheck?.lastError).toBe("timeout");
  });

  it("skips a checkId that doesn't belong to the device rather than crashing", async () => {
    const { app } = buildTestContainer();
    const agent = await seedAgent(app);
    const device = await seedDevice(app, { remoteAgentId: agent.id });
    const realCheck = await seedCheck(app, device.id);

    const outcome = await processAgentDeviceResults(app, agent, device.id, [
      { checkId: "not-a-real-check-id", result: { ok: true } },
      { checkId: realCheck.id, result: { ok: true, latencyMs: 12 } },
    ]);

    expect(outcome.ok).toBe(true);
  });
});

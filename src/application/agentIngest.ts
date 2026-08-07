import type { AppContainer } from "@ports/context";
import type { CheckResult, StateTransitionRecord } from "@ports/services";
import type { Metric, RemoteAgent } from "@domain/entities";
import { DEFAULT_POLICY, evaluateCheck, initialStatus, resolveThresholdOverrides } from "@domain/stateMachine";
import { aggregateCheckResults, type CheckRunResult } from "@domain/aggregateChecks";
import { isDeviceInMaintenance } from "@domain/maintenance";
import type { DomainEvent } from "@domain/events";

export interface AgentCheckResultInput {
  checkId: string;
  result: CheckResult;
}

export type AgentIngestOutcome = { ok: true } | { ok: false; error: string; status: 400 | 403 | 404 };

/**
 * The remote-agent equivalent of Scheduler.runDevice's persistence tail — takes check results a
 * remote agent already ran locally (rather than running a Checker itself) and puts them through
 * the exact same state-machine/aggregation/alerting pipeline a locally-polled device gets, so a
 * remote-agent-monitored device is indistinguishable from a local one everywhere except how its
 * raw check results were produced. Stateless per call (reads DeviceStatus from the repo, not an
 * in-memory cache like Scheduler's statusCache) since this runs once per HTTP request, not inside
 * a long-lived polling loop.
 */
export async function processAgentDeviceResults(
  app: AppContainer,
  agent: RemoteAgent,
  deviceId: string,
  inputs: AgentCheckResultInput[]
): Promise<AgentIngestOutcome> {
  const device = await app.repos.device.findById(agent.tenantId, deviceId);
  if (!device) return { ok: false, error: "Device not found", status: 404 };
  // The ownership boundary: an agent can only ever push results for a device explicitly assigned
  // to it. Without this check, any valid agent token could inject state for any device in the
  // tenant, including ones a completely different (and differently-trusted) agent owns.
  if (device.remoteAgentId !== agent.id) return { ok: false, error: "Device is not assigned to this agent", status: 403 };

  const checks = await app.repos.check.listByDevice(agent.tenantId, deviceId);
  const checksById = new Map(checks.map((c) => [c.id, c]));

  const results: CheckRunResult[] = [];
  const metrics: Metric[] = [];
  const nowIso = app.clock.nowIso();

  for (const input of inputs) {
    const check = checksById.get(input.checkId);
    if (!check) continue; // silently skip a checkId that doesn't belong to this device/tenant
    results.push({ kind: check.kind, result: input.result });

    if (input.result.values) {
      for (const [name, value] of Object.entries(input.result.values)) {
        metrics.push({ tenantId: device.tenantId, deviceId: device.id, checkId: check.id, ts: nowIso, name, value });
      }
    }
    if (input.result.latencyMs !== undefined) {
      metrics.push({ tenantId: device.tenantId, deviceId: device.id, checkId: check.id, ts: nowIso, name: `${check.kind}.latencyMs`, value: input.result.latencyMs });
    }

    const newLastError = input.result.error ?? null;
    if (newLastError !== (check.lastError ?? null)) {
      await app.repos.check.update(check.tenantId, check.id, { lastError: newLastError, lastErrorAt: newLastError ? nowIso : null });
    }
  }
  if (results.length === 0) return { ok: false, error: "No results matched a check on this device", status: 400 };

  const activeWindows = await app.repos.maintenance.listActive(device.tenantId, nowIso);
  const inMaintenance = isDeviceInMaintenance(activeWindows, device.id, device.groupId, nowIso);

  const outcome = aggregateCheckResults(results);
  const currentStatus = (await app.repos.status.findByDeviceId(device.tenantId, device.id)) ?? initialStatus(device.id, device.tenantId, nowIso);
  const policy = { ...DEFAULT_POLICY, thresholds: { ...DEFAULT_POLICY.thresholds, ...resolveThresholdOverrides(checks) } };

  const { status: newStatus, events } = evaluateCheck(currentStatus, outcome, policy, nowIso, inMaintenance);
  const stateChanged = newStatus.state !== currentStatus.state;

  const transitions: StateTransitionRecord[] = stateChanged
    ? [{ tenantId: device.tenantId, deviceId: device.id, newState: newStatus.state, atIso: nowIso }]
    : [];
  await app.tickPersister.persist([newStatus], metrics, transitions);

  for (const event of events) {
    app.events.emit<DomainEvent>("monitoring.event", event);
  }
  if (stateChanged) {
    app.events.emit("device.status_changed", { deviceId: device.id, tenantId: device.tenantId, state: newStatus.state, since: newStatus.since, latencyMs: newStatus.lastLatencyMs });
  }

  return { ok: true };
}

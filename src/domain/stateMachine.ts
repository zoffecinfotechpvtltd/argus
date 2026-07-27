// Pure state machine — no I/O, no Date.now(); every timestamp comes in as an argument so this is
// fully deterministic and testable. This is the heart of the monitoring engine (see PROGRESS.md).
import type { Check, DeviceState, DeviceStatus, TransitionEvent } from "@domain/entities";
import type { DomainEvent } from "@domain/events";

export interface CheckOutcome {
  ok: boolean;
  latencyMs?: number;
  lossPct?: number;
}

export interface StateMachinePolicy {
  failsToDown: number;
  okToUp: number;
  thresholds: { latencyMs?: number; lossPct?: number };
  flapWindowMs: number;
  flapThreshold: number;
  flapStableMs: number;
}

export const DEFAULT_POLICY: StateMachinePolicy = {
  failsToDown: 3,
  okToUp: 2,
  thresholds: { latencyMs: 200, lossPct: 10 },
  flapWindowMs: 10 * 60 * 1000,
  flapThreshold: 6,
  flapStableMs: 10 * 60 * 1000,
};

/** Per-device threshold overrides come from its ICMP check, if one sets latencyMs/lossPct — shared by the local Scheduler and the agent-results ingestion path (same domain policy, two different sources of check results). */
export function resolveThresholdOverrides(checks: Check[]): { latencyMs?: number; lossPct?: number } {
  for (const check of checks) {
    if (check.kind === "icmp" && (check.thresholds.latencyMs !== undefined || check.thresholds.lossPct !== undefined)) {
      return check.thresholds;
    }
  }
  return {};
}

export interface EvaluateResult {
  status: DeviceStatus;
  events: DomainEvent[];
}

function tsMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Advances a device's status given one check outcome. Pure function: same inputs -> same outputs.
 *
 * `inMaintenance` suppresses all emitted events and forces the reported state to "maintenance",
 * but consecutive-fail/ok counters keep advancing underneath so the real state is accurate the
 * instant maintenance ends (no artificial re-debounce lag).
 */
export function evaluateCheck(
  current: DeviceStatus,
  outcome: CheckOutcome,
  policy: StateMachinePolicy,
  nowIso: string,
  inMaintenance = false
): EvaluateResult {
  const consecutiveFails = outcome.ok ? 0 : current.consecutiveFails + 1;
  const consecutiveOk = outcome.ok ? current.consecutiveOk + 1 : 0;
  const lastSeen = outcome.ok ? nowIso : current.lastSeen;
  const lastLatencyMs = outcome.latencyMs ?? current.lastLatencyMs;

  if (inMaintenance) {
    return {
      status: {
        ...current,
        state: "maintenance",
        since: current.state === "maintenance" ? current.since : nowIso,
        lastSeen,
        lastLatencyMs,
        consecutiveFails,
        consecutiveOk,
      },
      events: [],
    };
  }

  // Treat "maintenance"/"flapping" as an unknown baseline: fall back to "up" and let the
  // consecutive counters re-derive the real state within failsToDown/okToUp cycles.
  const underlyingState: DeviceState = current.state === "up" || current.state === "degraded" || current.state === "down" ? current.state : "up";

  let candidateState: DeviceState = underlyingState;
  if ((underlyingState === "up" || underlyingState === "degraded") && consecutiveFails >= policy.failsToDown) {
    candidateState = "down";
  } else if (underlyingState === "down" && consecutiveOk >= policy.okToUp) {
    candidateState = "up";
  }

  let breach: { metric: string; value: number; limit: number } | null = null;
  if (candidateState !== "down" && outcome.ok) {
    if (policy.thresholds.latencyMs != null && outcome.latencyMs != null && outcome.latencyMs > policy.thresholds.latencyMs) {
      breach = { metric: "latencyMs", value: outcome.latencyMs, limit: policy.thresholds.latencyMs };
    } else if (policy.thresholds.lossPct != null && outcome.lossPct != null && outcome.lossPct > policy.thresholds.lossPct) {
      breach = { metric: "lossPct", value: outcome.lossPct, limit: policy.thresholds.lossPct };
    }
  }
  if (candidateState !== "down") {
    candidateState = breach ? "degraded" : "up";
  }

  const events: DomainEvent[] = [];
  if (candidateState !== underlyingState) {
    if (candidateState === "down") {
      events.push({ type: "DeviceWentDown", deviceId: current.deviceId, tenantId: current.tenantId, at: nowIso });
    } else if (underlyingState === "down") {
      events.push({ type: "DeviceRecovered", deviceId: current.deviceId, tenantId: current.tenantId, at: nowIso });
    } else if (candidateState === "degraded" && underlyingState === "up") {
      events.push({ type: "DeviceDegraded", deviceId: current.deviceId, tenantId: current.tenantId, at: nowIso });
    } else if (candidateState === "up" && underlyingState === "degraded") {
      events.push({ type: "DeviceRecovered", deviceId: current.deviceId, tenantId: current.tenantId, at: nowIso });
    }
  }
  if (breach) {
    events.push({ type: "ThresholdBreached", deviceId: current.deviceId, tenantId: current.tenantId, at: nowIso, ...breach });
  }

  let transitionLog: TransitionEvent[] = current.transitionLog;
  if (candidateState !== underlyingState) {
    transitionLog = [...transitionLog, { at: nowIso, from: underlyingState, to: candidateState }];
  }
  const nowMs = tsMs(nowIso);
  transitionLog = transitionLog.filter((t) => nowMs - tsMs(t.at) <= policy.flapWindowMs * 2);

  const recentTransitions = transitionLog.filter((t) => nowMs - tsMs(t.at) <= policy.flapWindowMs).length;

  let finalState: DeviceState = candidateState;
  let finalEvents: DomainEvent[] = events;

  if (current.state === "flapping") {
    const lastTransition = transitionLog[transitionLog.length - 1];
    const stableForMs = lastTransition ? nowMs - tsMs(lastTransition.at) : Infinity;
    if (stableForMs >= policy.flapStableMs) {
      finalState = candidateState; // stable long enough — resume normal reporting
    } else {
      finalState = "flapping";
      finalEvents = [];
    }
  } else if (recentTransitions > policy.flapThreshold) {
    finalState = "flapping";
    finalEvents = [{ type: "DeviceFlapping", deviceId: current.deviceId, tenantId: current.tenantId, at: nowIso }];
  }

  return {
    status: {
      ...current,
      state: finalState,
      since: finalState !== current.state ? nowIso : current.since,
      lastSeen,
      lastLatencyMs,
      consecutiveFails,
      consecutiveOk,
      transitionLog,
    },
    events: finalEvents,
  };
}

export function initialStatus(deviceId: string, tenantId: string, nowIso: string): DeviceStatus {
  return {
    deviceId,
    tenantId,
    state: "up",
    since: nowIso,
    lastSeen: null,
    lastLatencyMs: null,
    consecutiveFails: 0,
    consecutiveOk: 0,
    transitionLog: [],
  };
}

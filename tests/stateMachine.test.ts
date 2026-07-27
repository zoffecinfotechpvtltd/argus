import { describe, expect, it } from "bun:test";
import { DEFAULT_POLICY, evaluateCheck, initialStatus, type StateMachinePolicy } from "@domain/stateMachine";
import type { DeviceStatus } from "@domain/entities";

const T0 = new Date("2026-01-01T00:00:00.000Z");
function iso(offsetSec: number): string {
  return new Date(T0.getTime() + offsetSec * 1000).toISOString();
}

describe("evaluateCheck — up/down transitions", () => {
  it("stays UP on consecutive successes", () => {
    let status = initialStatus("d1", "local", iso(0));
    for (let i = 1; i <= 5; i++) {
      status = evaluateCheck(status, { ok: true, latencyMs: 10 }, DEFAULT_POLICY, iso(i * 60)).status;
    }
    expect(status.state).toBe("up");
  });

  it("does NOT go down on 1 or 2 failures (no single-ping false alarms)", () => {
    let status = initialStatus("d1", "local", iso(0));
    let events;
    ({ status, events } = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(60)));
    expect(status.state).toBe("up");
    expect(events).toEqual([]);
    ({ status, events } = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(120)));
    expect(status.state).toBe("up");
    expect(events).toEqual([]);
  });

  it("goes DOWN on exactly the 3rd consecutive failure and emits DeviceWentDown once", () => {
    let status = initialStatus("d1", "local", iso(0));
    let events;
    ({ status } = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(60)));
    ({ status } = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(120)));
    ({ status, events } = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(180)));
    expect(status.state).toBe("down");
    expect(events).toEqual([{ type: "DeviceWentDown", deviceId: "d1", tenantId: "local", at: iso(180) }]);

    // stays down, no duplicate event
    ({ status, events } = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(240)));
    expect(status.state).toBe("down");
    expect(events).toEqual([]);
  });

  it("recovers to UP after exactly okToUp (2) consecutive successes and emits DeviceRecovered once", () => {
    let status = initialStatus("d1", "local", iso(0));
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(60)).status;
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(120)).status;
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(180)).status;
    expect(status.state).toBe("down");

    let events;
    ({ status, events } = evaluateCheck(status, { ok: true, latencyMs: 10 }, DEFAULT_POLICY, iso(240)));
    expect(status.state).toBe("down"); // only 1 success so far
    expect(events).toEqual([]);

    ({ status, events } = evaluateCheck(status, { ok: true, latencyMs: 10 }, DEFAULT_POLICY, iso(300)));
    expect(status.state).toBe("up");
    expect(events).toEqual([{ type: "DeviceRecovered", deviceId: "d1", tenantId: "local", at: iso(300) }]);
  });
});

describe("evaluateCheck — DEGRADED via thresholds", () => {
  it("transitions UP -> DEGRADED when latency exceeds the threshold, emitting DeviceDegraded + ThresholdBreached", () => {
    const status = initialStatus("d1", "local", iso(0));
    const { status: s2, events } = evaluateCheck(status, { ok: true, latencyMs: 500 }, DEFAULT_POLICY, iso(60));
    expect(s2.state).toBe("degraded");
    expect(events).toEqual([
      { type: "DeviceDegraded", deviceId: "d1", tenantId: "local", at: iso(60) },
      { type: "ThresholdBreached", deviceId: "d1", tenantId: "local", at: iso(60), metric: "latencyMs", value: 500, limit: 200 },
    ]);
  });

  it("keeps emitting ThresholdBreached every cycle while still breached, without repeating DeviceDegraded", () => {
    let status = initialStatus("d1", "local", iso(0));
    status = evaluateCheck(status, { ok: true, latencyMs: 500 }, DEFAULT_POLICY, iso(60)).status;
    const { status: s2, events } = evaluateCheck(status, { ok: true, latencyMs: 600 }, DEFAULT_POLICY, iso(120));
    expect(s2.state).toBe("degraded");
    expect(events).toEqual([{ type: "ThresholdBreached", deviceId: "d1", tenantId: "local", at: iso(120), metric: "latencyMs", value: 600, limit: 200 }]);
  });

  it("recovers DEGRADED -> UP once latency is back under threshold, emitting DeviceRecovered", () => {
    let status = initialStatus("d1", "local", iso(0));
    status = evaluateCheck(status, { ok: true, latencyMs: 500 }, DEFAULT_POLICY, iso(60)).status;
    const { status: s2, events } = evaluateCheck(status, { ok: true, latencyMs: 20 }, DEFAULT_POLICY, iso(120));
    expect(s2.state).toBe("up");
    expect(events).toEqual([{ type: "DeviceRecovered", deviceId: "d1", tenantId: "local", at: iso(120) }]);
  });

  it("degrades on packet loss threshold too", () => {
    const status = initialStatus("d1", "local", iso(0));
    const { status: s2 } = evaluateCheck(status, { ok: true, latencyMs: 10, lossPct: 50 }, DEFAULT_POLICY, iso(60));
    expect(s2.state).toBe("degraded");
  });

  it("goes straight to DOWN from DEGRADED after enough consecutive failures", () => {
    let status = initialStatus("d1", "local", iso(0));
    status = evaluateCheck(status, { ok: true, latencyMs: 500 }, DEFAULT_POLICY, iso(60)).status;
    expect(status.state).toBe("degraded");
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(120)).status;
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(180)).status;
    const { status: s2, events } = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(240));
    expect(s2.state).toBe("down");
    expect(events).toEqual([{ type: "DeviceWentDown", deviceId: "d1", tenantId: "local", at: iso(240) }]);
  });
});

describe("evaluateCheck — flapping", () => {
  const fastPolicy: StateMachinePolicy = { ...DEFAULT_POLICY, flapWindowMs: 10 * 60 * 1000, flapThreshold: 6, flapStableMs: 5 * 60 * 1000 };

  it("enters FLAPPING after more than 6 transitions inside the 10-minute window and emits exactly one DeviceFlapping event", () => {
    let status = initialStatus("d1", "local", iso(0));
    let t = 0;
    const allEvents: string[] = [];

    // Alternate down/up rapidly: each pair of (3 fails + 2 oks) produces 2 transitions (up->down, down->up).
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let f = 0; f < 3; f++) {
        t += 10;
        const r = evaluateCheck(status, { ok: false }, fastPolicy, iso(t));
        status = r.status;
        allEvents.push(...r.events.map((e) => e.type));
      }
      for (let ok = 0; ok < 2; ok++) {
        t += 10;
        const r = evaluateCheck(status, { ok: true, latencyMs: 10 }, fastPolicy, iso(t));
        status = r.status;
        allEvents.push(...r.events.map((e) => e.type));
      }
    }

    expect(status.state).toBe("flapping");
    expect(allEvents.filter((e) => e === "DeviceFlapping").length).toBe(1);
  });

  it("suppresses further transition events while flapping", () => {
    let status = initialStatus("d1", "local", iso(0));
    let t = 0;
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let f = 0; f < 3; f++) {
        t += 10;
        status = evaluateCheck(status, { ok: false }, fastPolicy, iso(t)).status;
      }
      for (let ok = 0; ok < 2; ok++) {
        t += 10;
        status = evaluateCheck(status, { ok: true, latencyMs: 10 }, fastPolicy, iso(t)).status;
      }
    }
    expect(status.state).toBe("flapping");

    // One more failure cycle while flapping — should NOT emit DeviceWentDown even though 3 fails occur.
    t += 10;
    let r = evaluateCheck(status, { ok: false }, fastPolicy, iso(t));
    status = r.status;
    t += 10;
    r = evaluateCheck(status, { ok: false }, fastPolicy, iso(t));
    status = r.status;
    t += 10;
    r = evaluateCheck(status, { ok: false }, fastPolicy, iso(t));
    status = r.status;
    expect(r.events).toEqual([]);
    expect(status.state).toBe("flapping");
  });

  it("exits FLAPPING and resumes normal reporting once stable for flapStableMs", () => {
    let status = initialStatus("d1", "local", iso(0));
    let t = 0;
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let f = 0; f < 3; f++) {
        t += 10;
        status = evaluateCheck(status, { ok: false }, fastPolicy, iso(t)).status;
      }
      for (let ok = 0; ok < 2; ok++) {
        t += 10;
        status = evaluateCheck(status, { ok: true, latencyMs: 10 }, fastPolicy, iso(t)).status;
      }
    }
    expect(status.state).toBe("flapping");

    // Stay stable (all successes) for longer than flapStableMs (5 min) with no new transitions.
    t += fastPolicy.flapStableMs / 1000 + 60;
    const r = evaluateCheck(status, { ok: true, latencyMs: 10 }, fastPolicy, iso(t));
    expect(r.status.state).toBe("up");
  });
});

describe("evaluateCheck — maintenance", () => {
  it("forces state to maintenance and suppresses all events, while still updating consecutive counters", () => {
    let status = initialStatus("d1", "local", iso(0));
    const r1 = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(60), true);
    expect(r1.status.state).toBe("maintenance");
    expect(r1.events).toEqual([]);
    status = r1.status;

    const r2 = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(120), true);
    expect(r2.status.state).toBe("maintenance");
    expect(r2.events).toEqual([]);
    status = r2.status;

    const r3 = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(180), true);
    expect(r3.status.state).toBe("maintenance"); // still forced, even though underlying counters hit failsToDown
    expect(r3.events).toEqual([]);
    expect(r3.status.consecutiveFails).toBe(3);
  });

  it("reflects true state immediately once maintenance ends, using counters accumulated during the window", () => {
    let status = initialStatus("d1", "local", iso(0));
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(60), true).status;
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(120), true).status;
    status = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(180), true).status;
    expect(status.consecutiveFails).toBe(3);

    // Maintenance window ends; next check still fails -> should immediately reflect DOWN since counters already at threshold.
    const r = evaluateCheck(status, { ok: false }, DEFAULT_POLICY, iso(240), false);
    expect(r.status.state).toBe("down");
  });

  it("still records metrics data (lastSeen/lastLatencyMs) during maintenance", () => {
    const status = initialStatus("d1", "local", iso(0));
    const r = evaluateCheck(status, { ok: true, latencyMs: 42 }, DEFAULT_POLICY, iso(60), true);
    expect(r.status.lastSeen).toBe(iso(60));
    expect(r.status.lastLatencyMs).toBe(42);
  });
});

describe("initialStatus", () => {
  it("starts UP with zeroed counters", () => {
    const s: DeviceStatus = initialStatus("d1", "local", iso(0));
    expect(s.state).toBe("up");
    expect(s.consecutiveFails).toBe(0);
    expect(s.consecutiveOk).toBe(0);
    expect(s.transitionLog).toEqual([]);
  });
});

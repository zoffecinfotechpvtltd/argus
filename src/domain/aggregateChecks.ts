// Pure aggregation — no I/O. A device runs N checks (icmp/tcp/http/snmp); the state machine
// needs one outcome per device. Policy: the device is UP only if every enabled check passed.
import type { CheckKind } from "@domain/entities";
import type { CheckResult } from "@ports/services";
import type { CheckOutcome } from "@domain/stateMachine";

export interface CheckRunResult {
  kind: CheckKind;
  result: CheckResult;
}

export function aggregateCheckResults(results: CheckRunResult[]): CheckOutcome {
  if (results.length === 0) return { ok: false };

  const icmp = results.find((r) => r.kind === "icmp");
  const primary = icmp ?? results[0]!;
  const ok = results.every((r) => r.result.ok);

  return {
    ok,
    latencyMs: primary.result.latencyMs,
    lossPct: icmp?.result.values?.lossPct,
  };
}

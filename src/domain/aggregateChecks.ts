// Pure aggregation — no I/O. A device runs N checks (icmp/tcp/http/snmp/fortigate_api); the state
// machine needs one outcome per device. Policy: ICMP is authoritative for reachability when
// present — ping proves the device is actually up regardless of what any richer secondary check
// (SNMP, HTTP, a vendor REST API) reports. A misconfigured/unreachable secondary check (wrong
// creds, a trusted-hosts restriction, a permissions gap) is a monitoring-quality problem, not
// evidence the device itself went down, and treating it as one produces exactly the false "it's
// down but it's actually on" alerts this product is built to avoid. Each individual check's own
// result.ok is still recorded per-check (see scheduler.ts's CheckRunResult persistence) so a
// failing secondary check remains visible on the device's detail page — it just doesn't drive the
// device's own up/down state. For a device with no ICMP check at all (e.g. ping is firewalled off
// and HTTP/SNMP is the only signal), that sole check is the primary and does gate state, same as
// before.
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

  return {
    ok: primary.result.ok,
    latencyMs: primary.result.latencyMs,
    lossPct: icmp?.result.values?.lossPct,
  };
}

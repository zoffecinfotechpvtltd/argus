import type { Check, Device } from "@domain/entities";
import type { CheckResult, Checker } from "@ports/services";
import { pingHost } from "@adapters/net/ping";

export class IcmpChecker implements Checker {
  async run(device: Device, _check: Check): Promise<CheckResult> {
    const result = await pingHost(device.ip, 3, 1000);
    if (!result.ok) {
      return { ok: false, error: "No reply", values: { lossPct: result.lossPct } };
    }
    return { ok: true, latencyMs: result.latencyMs, values: { lossPct: result.lossPct } };
  }
}

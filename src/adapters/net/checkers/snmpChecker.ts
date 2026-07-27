import type { Check, Device } from "@domain/entities";
import type { CheckResult, Checker } from "@ports/services";
import { pollSnmpMetrics } from "@adapters/net/snmpMetrics";
import { decryptSecret } from "@adapters/crypto";
import { isBlockedAddress } from "@domain/ssrfGuard";

export class SnmpChecker implements Checker {
  constructor(private instanceKey: Buffer) {}

  async run(device: Device, check: Check): Promise<CheckResult> {
    // Same SSRF guard as httpChecker.ts — an SNMP poll returns real OID values (interface names,
    // counters, sysName) that get stored and displayed, so pointing one at a link-local/metadata
    // address is a real data-exposure vector, not just a reachability probe.
    if (isBlockedAddress(device.ip, { allowLoopback: check.config.allowLocalhost as boolean | undefined })) {
      return { ok: false, error: "Blocked by SSRF guard: link-local/metadata address, or loopback without allowLocalhost" };
    }

    if (!device.snmpCredsEnc) return { ok: false, error: "No SNMP credentials configured for this device" };

    let community: string;
    try {
      community = decryptSecret(this.instanceKey, device.snmpCredsEnc);
    } catch {
      return { ok: false, error: "Failed to decrypt SNMP credentials" };
    }

    const start = performance.now();
    const result = await pollSnmpMetrics({
      ip: device.ip,
      community,
      interfaces: check.config.interfaces,
      timeoutMs: check.config.timeoutMs ?? 3000,
    });
    const latencyMs = Math.round((performance.now() - start) * 10) / 10;

    if (!result.ok) return { ok: false, latencyMs, error: result.error };
    return { ok: true, latencyMs, values: result.values };
  }
}

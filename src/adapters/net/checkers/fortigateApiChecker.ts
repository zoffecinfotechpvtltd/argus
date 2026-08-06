import type { Check, Device } from "@domain/entities";
import type { CheckResult, Checker } from "@ports/services";
import { isBlockedAddress } from "@domain/ssrfGuard";
import { decryptSecret } from "@adapters/crypto";
import { parseVendorApiCredential } from "@domain/vendorApiCredential";

interface FortiGateSystemStatus {
  results?: { version?: string; serial?: string; hostname?: string };
}

interface FortiGateResourceUsage {
  results?: { resources?: Array<{ id?: string; current?: number }> };
}

interface FortiGateHaChecksums {
  results?: { is_root?: boolean };
}

interface FortiGateIpsecTunnels {
  results?: Array<{ proxyid?: Array<{ status?: string }> }>;
}

/** Polls the FortiGate REST API (api/v2/monitor/*) for CPU/mem/session/VPN-tunnel metrics and
 * model/firmware/serial/HA-role identity facts. All sub-calls are best-effort and independent —
 * one endpoint failing (older FortiOS build missing it, insufficient API-user permissions) never
 * blanks out the metrics the others did return. Only a failure of the base system/status call
 * (used to confirm the device is actually a reachable FortiGate) fails the whole check. */
export class FortiGateApiChecker implements Checker {
  constructor(private readonly instanceKey: Buffer) {}

  async run(device: Device, check: Check): Promise<CheckResult> {
    if (isBlockedAddress(device.ip, { allowLoopback: check.config.allowLocalhost as boolean | undefined })) {
      return { ok: false, error: "Blocked by SSRF guard: link-local/metadata address, or loopback without allowLocalhost" };
    }
    if (!device.apiCredsEnc) return { ok: false, error: "No vendor API credentials configured for this device" };

    let credential;
    try {
      credential = parseVendorApiCredential(decryptSecret(this.instanceKey, device.apiCredsEnc));
    } catch {
      return { ok: false, error: "Failed to decrypt vendor API credentials" };
    }

    const port = credential.port ?? 443;
    const verifyTls = credential.verifyTls ?? true;
    const timeoutMs = check.config.timeoutMs ?? 5000;
    const base = `https://${device.ip}:${port}/api/v2/monitor`;
    const fetchOpts: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
      method: "GET",
      headers: { Authorization: `Bearer ${credential.apiToken}` },
      signal: AbortSignal.timeout(timeoutMs),
      tls: verifyTls ? undefined : { rejectUnauthorized: false },
    };

    const start = performance.now();
    let statusJson: FortiGateSystemStatus;
    try {
      const res = await fetch(`${base}/system/status`, fetchOpts);
      if (!res.ok) return { ok: false, latencyMs: Math.round(performance.now() - start), error: `system/status HTTP ${res.status}` };
      statusJson = (await res.json()) as FortiGateSystemStatus;
    } catch (err) {
      return { ok: false, latencyMs: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) };
    }
    const latencyMs = Math.round((performance.now() - start) * 10) / 10;

    const values: Record<string, number> = {};
    const deviceFacts: NonNullable<CheckResult["deviceFacts"]> = {};
    if (statusJson.results?.version) deviceFacts.firmwareVersion = statusJson.results.version;
    if (statusJson.results?.serial) deviceFacts.serialNumber = statusJson.results.serial;

    try {
      const res = await fetch(`${base}/system/resource/usage?resource=cpu,mem,session`, fetchOpts);
      if (res.ok) {
        const json = (await res.json()) as FortiGateResourceUsage;
        for (const r of json.results?.resources ?? []) {
          if (r.id === "cpu" && typeof r.current === "number") values.cpuPct = r.current;
          if (r.id === "mem" && typeof r.current === "number") values.memUsedPct = r.current;
          if (r.id === "session" && typeof r.current === "number") values.sessionCount = r.current;
        }
      }
    } catch {
      /* best-effort — resource/usage missing on some FortiOS builds/permissions */
    }

    try {
      const res = await fetch(`${base}/system/ha-checksums`, fetchOpts);
      if (res.ok) {
        const json = (await res.json()) as FortiGateHaChecksums;
        if (typeof json.results?.is_root === "boolean") {
          deviceFacts.haRole = json.results.is_root ? "primary" : "secondary";
        }
      }
    } catch {
      /* best-effort — standalone (non-HA) units don't expose this meaningfully */
    }

    try {
      const res = await fetch(`${base}/vpn/ipsec`, fetchOpts);
      if (res.ok) {
        const json = (await res.json()) as FortiGateIpsecTunnels;
        const tunnels = json.results ?? [];
        const up = tunnels.filter((t) => (t.proxyid ?? []).some((p) => p.status === "up")).length;
        values.vpnTunnelsTotal = tunnels.length;
        values.vpnTunnelsUp = up;
      }
    } catch {
      /* best-effort — no configured IPsec tunnels returns an empty/absent result on some builds */
    }

    return { ok: true, latencyMs, values, ...(Object.keys(deviceFacts).length > 0 ? { deviceFacts } : {}) };
  }
}

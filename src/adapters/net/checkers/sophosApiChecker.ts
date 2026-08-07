import type { Check, Device } from "@domain/entities";
import type { CheckResult, Checker } from "@ports/services";
import { isBlockedAddress } from "@domain/ssrfGuard";
import { decryptSecret } from "@adapters/crypto";
import { parseSophosApiCredential } from "@domain/vendorApiCredential";

/**
 * Polls Sophos Firewall's (SFOS/XG) on-prem classic XML API — a fundamentally different shape from
 * FortiGate's REST monitor API: no JSON, no bearer token, and (this is the important limitation)
 * no dedicated live-telemetry endpoint. The classic API is built for reading/writing configuration
 * objects (firewall rules, IPHost entries, VPN connections, ...), not a stats feed — Sophos simply
 * doesn't expose CPU/memory/session counters through it the way FortiGate does. Use SNMP alongside
 * this check for resource metrics (see Bandwidth page / generic snmpChecker); this check's job is
 * auth validation (proves the device + API user are actually reachable/correct — the primary
 * gating signal, mirroring FortiGate's system/status call) plus IPsec tunnel status as enrichment.
 *
 * XML entity/field names are the documented shape as of Sophos Firewall API v15-19 but genuinely
 * vary across firmware versions in ways FortiGate's API doesn't — if this starts failing after a
 * firmware upgrade, the response body (logged via the returned error) is the first thing to check
 * against that version's API guide.
 */
export class SophosApiChecker implements Checker {
  constructor(private readonly instanceKey: Buffer) {}

  async run(device: Device, check: Check): Promise<CheckResult> {
    if (isBlockedAddress(device.ip, { allowLoopback: check.config.allowLocalhost as boolean | undefined })) {
      return { ok: false, error: "Blocked by SSRF guard: link-local/metadata address, or loopback without allowLocalhost" };
    }
    if (!device.apiCredsEnc) return { ok: false, error: "No vendor API credentials configured for this device" };

    let credential;
    try {
      credential = parseSophosApiCredential(decryptSecret(this.instanceKey, device.apiCredsEnc));
    } catch {
      return { ok: false, error: "Failed to decrypt vendor API credentials" };
    }

    const port = credential.port ?? 4444;
    const verifyTls = credential.verifyTls ?? true;
    const timeoutMs = check.config.timeoutMs ?? 5000;
    const url = `https://${device.ip}:${port}/webconsole/APIController`;
    const fetchOpts = (body: string): RequestInit & { tls?: { rejectUnauthorized: boolean } } => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `reqxml=${encodeURIComponent(body)}`,
      signal: AbortSignal.timeout(timeoutMs),
      tls: verifyTls ? undefined : { rejectUnauthorized: false },
    });

    const loginXml = buildLoginRequest(credential.username, credential.password);
    const start = performance.now();
    let text: string;
    try {
      const res = await fetch(url, fetchOpts(loginXml));
      text = await res.text();
      if (!res.ok) return { ok: false, latencyMs: Math.round(performance.now() - start), error: `APIController HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) };
    }
    const latencyMs = Math.round((performance.now() - start) * 10) / 10;

    if (!/authentication\s+successful/i.test(text)) {
      // Sophos returns a <Status code="...">...</Status> block describing exactly what went
      // wrong (bad credentials, API access disabled for this admin profile, wrong zone) — surface
      // a short slice of it rather than just "failed", since that message is the actual fix.
      const statusMatch = /<Status[^>]*>([^<]{0,200})/i.exec(text);
      return { ok: false, latencyMs, error: statusMatch ? `Login failed: ${statusMatch[1]!.trim()}` : "Login failed (unrecognized response — check API is enabled for this admin profile)" };
    }

    const values: Record<string, number> = {};
    try {
      const vpnXml = buildGetRequest(credential.username, credential.password, "VPNIPSecConnection");
      const res = await fetch(url, fetchOpts(vpnXml));
      if (res.ok) {
        const vpnText = await res.text();
        const total = countOccurrences(vpnText, /<VPNIPSecConnection>/gi);
        const up = countOccurrences(vpnText, /<ConnectionStatus>\s*Active\s*<\/ConnectionStatus>/gi);
        if (total > 0) {
          values.vpnTunnelsTotal = total;
          values.vpnTunnelsUp = up;
        }
      }
    } catch {
      /* best-effort — no configured IPsec connections, or this firmware exposes the entity under a different name */
    }

    return { ok: true, latencyMs, values };
  }
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildLoginRequest(username: string, password: string): string {
  return `<Request><Login><Username>${xmlEscape(username)}</Username><Password>${xmlEscape(password)}</Password></Login></Request>`;
}

function buildGetRequest(username: string, password: string, entity: string): string {
  return `<Request><Login><Username>${xmlEscape(username)}</Username><Password>${xmlEscape(password)}</Password></Login><Get><${entity}/></Get></Request>`;
}

function countOccurrences(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

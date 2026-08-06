import { lookup } from "node:dns/promises";
import { isBlockedAddress, isPrivateAddress } from "@domain/ssrfGuard";
import type { ExternalUrlGuard } from "@ports/services";

/** SSRF guard for any admin-configured "call out to an external URL" setting: the update-check/
 * update-apply feed URL and heartbeatScheduler.ts's dead-man's-switch ping URL both go through
 * this. Same rationale and DNS-rebinding caveat as @adapters/notify/webhookNotifier.ts's
 * validateWebhookUrl: these are meant to point at an external server, not the LAN this product
 * monitors, so private ranges are blocked in addition to loopback/link-local. Only https:// is
 * allowed — plain http would let a network-position attacker tamper with (or simply observe) the
 * request. */
export class DnsResolvingExternalUrlGuard implements ExternalUrlGuard {
  async assertSafe(target: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error(`Invalid URL: ${target}`);
    }
    if (parsed.protocol !== "https:") throw new Error(`URL must be https://: ${target}`);

    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(parsed.hostname, { all: true });
    } catch {
      throw new Error(`Could not resolve hostname: ${parsed.hostname}`);
    }
    for (const addr of addresses) {
      // Checked regardless of family — see ssrfGuard.ts; a hostname with only a AAAA record used to
      // skip validation entirely here since the loop never found an IPv4 address to check.
      if (isBlockedAddress(addr.address)) throw new Error(`Blocked by SSRF guard: ${parsed.hostname} resolves to a link-local/loopback address`);
      if (isPrivateAddress(addr.address)) throw new Error(`Blocked by SSRF guard: ${parsed.hostname} resolves to a private network address`);
    }
  }
}

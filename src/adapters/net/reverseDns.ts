import { reverse } from "node:dns/promises";

const TIMEOUT_MS = 1500;

/** Best-effort PTR lookup: the hostname a device (or its router) has advertised for its IP.
 * Many DHCP servers register a client-supplied name here (e.g. "Johns-iPhone", "DESKTOP-A1B2C3"),
 * which is often a stronger classification signal than OUI vendor alone. Returns null on any
 * failure (NXDOMAIN, timeout, no PTR record) — this is enrichment, never a hard requirement. */
export async function reverseDnsLookup(ip: string): Promise<string | null> {
  try {
    const names = await Promise.race([
      reverse(ip),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

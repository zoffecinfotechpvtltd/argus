import { reverse } from "node:dns/promises";

const TIMEOUT_MS = 1500;

/** Synthetic names a local container runtime's own virtual network resolver hands back for its
 * internal gateway/host addresses (e.g. Docker Desktop's "gateway.docker.internal") — real on the
 * machine running the scan, but never the actual device at that IP, so surfacing it as a device's
 * name/hostname just looks like a bug to a customer. Filtered here so it never reaches
 * classification or a device's pre-filled name; PTR results otherwise pass through untouched. */
const SYNTHETIC_HOSTNAME = /(^|\.)docker\.internal$/i;

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
    const name = names[0] ?? null;
    return name && !SYNTHETIC_HOSTNAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

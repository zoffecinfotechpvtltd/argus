// Pure — no I/O. Blocks link-local (incl. cloud metadata, 169.254.169.254) and loopback ranges
// unless explicitly allowed. Private RFC1918 ranges (10/8, 172.16/12, 192.168/16) are NOT blocked
// — monitoring devices on the local LAN is the whole point of this product.

function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function inRange(ipInt: number, baseIp: string, prefixLen: number): boolean {
  const base = ipToInt(baseIp)!;
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

const LINK_LOCAL = { base: "169.254.0.0", prefix: 16 }; // includes the 169.254.169.254 cloud metadata endpoint
const LOOPBACK = { base: "127.0.0.0", prefix: 8 };
const PRIVATE_RANGES = [
  { base: "10.0.0.0", prefix: 8 },
  { base: "172.16.0.0", prefix: 12 },
  { base: "192.168.0.0", prefix: 16 },
];

export function isBlockedAddress(ip: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const ipInt = ipToInt(ip);
  if (ipInt === null) return false; // not an IPv4 literal — caller's DNS-resolution step handles hostnames
  if (inRange(ipInt, LINK_LOCAL.base, LINK_LOCAL.prefix)) return true;
  if (!opts.allowLoopback && inRange(ipInt, LOOPBACK.base, LOOPBACK.prefix)) return true;
  return false;
}

/** RFC1918 private ranges — deliberately a SEPARATE check from isBlockedAddress, not folded into
 * it: device checks (httpChecker etc.) must be able to reach 10/8, 172.16/12, 192.168/16 — that's
 * the LAN this product monitors. A notification webhook has no such legitimate use case; it's
 * meant to reach an external alerting endpoint, so callers for that use case (see
 * adapters/notify/webhookNotifier.ts) should call this in addition to isBlockedAddress. */
export function isPrivateAddress(ip: string): boolean {
  const ipInt = ipToInt(ip);
  if (ipInt === null) return false;
  return PRIVATE_RANGES.some((r) => inRange(ipInt, r.base, r.prefix));
}

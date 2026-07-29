// Pure — no I/O. Blocks link-local (incl. cloud metadata, 169.254.169.254) and loopback ranges
// unless explicitly allowed. Private RFC1918 ranges (10/8, 172.16/12, 192.168/16) are NOT blocked
// — monitoring devices on the local LAN is the whole point of this product. IPv6 gets the
// equivalent treatment (::1, fe80::/10, fc00::/7, IPv4-mapped ::ffff:a.b.c.d) — earlier versions
// of this guard only understood IPv4 literals, so callers that resolved a hostname and skipped its
// non-IPv4 addresses (see webhookNotifier.ts / generalSettings.ts) were silently letting an
// IPv6-only hostname (one with only a AAAA record, no A record) straight through unchecked.

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

/** Expands an IPv6 literal (accepts the "::" compression form, and a trailing embedded IPv4
 * dotted-quad as in "::ffff:169.254.169.254") into 8 16-bit groups. Returns null for anything
 * that isn't a syntactically plausible IPv6 address — callers should treat that as "not IPv6",
 * not as "safe". */
function expandIpv6(ip: string): number[] | null {
  let addr = ip;
  // Strip a zone ID (e.g. "fe80::1%eth0") — not meaningful for range checks.
  const zoneIdx = addr.indexOf("%");
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  const halves = addr.split("::");
  if (halves.length > 2) return null; // more than one "::" is never valid

  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const pieces = s.split(":");
    const groups: number[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      // An embedded IPv4 dotted-quad only makes sense as the final piece (e.g. "::ffff:1.2.3.4").
      if (piece.includes(".")) {
        if (i !== pieces.length - 1) return null;
        const v4 = ipToInt(piece);
        if (v4 === null) return null;
        groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };

  if (halves.length === 1) {
    const groups = parseGroups(halves[0]!);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = parseGroups(halves[0]!);
  const tail = parseGroups(halves[1]!);
  if (!head || !tail || head.length + tail.length >= 8) return null;
  const middle = new Array(8 - head.length - tail.length).fill(0);
  return [...head, ...middle, ...tail];
}

/** If `groups` is an IPv4-mapped address (::ffff:a.b.c.d — how a dual-stack socket represents an
 * IPv4 peer), returns the embedded IPv4 as an integer so it can be checked with the existing IPv4
 * range logic. The older, deprecated "IPv4-compatible" form (bare ::a.b.c.d, no ffff) is not
 * handled — it's obsolete (RFC4291/RFC5156) and not something any real resolver or socket API
 * produces today. */
function embeddedIpv4(groups: number[]): number | null {
  const isMapped = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff;
  if (!isMapped) return null;
  return (((groups[6]! << 16) | groups[7]!) >>> 0) as number;
}

function isIpv6Loopback(groups: number[]): boolean {
  return groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
}

function isIpv6Unspecified(groups: number[]): boolean {
  return groups.every((g) => g === 0);
}

function isIpv6LinkLocal(groups: number[]): boolean {
  return (groups[0]! & 0xffc0) === 0xfe80; // fe80::/10
}

function isIpv6UniqueLocal(groups: number[]): boolean {
  return (groups[0]! & 0xfe00) === 0xfc00; // fc00::/7 — IPv6's RFC1918 equivalent
}

export function isBlockedAddress(ip: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const ipInt = ipToInt(ip);
  if (ipInt !== null) {
    if (inRange(ipInt, LINK_LOCAL.base, LINK_LOCAL.prefix)) return true;
    if (!opts.allowLoopback && inRange(ipInt, LOOPBACK.base, LOOPBACK.prefix)) return true;
    return false;
  }

  const groups = expandIpv6(ip);
  if (groups === null) return false; // not an IP literal at all — caller's DNS-resolution step handles hostnames

  const mapped = embeddedIpv4(groups);
  if (mapped !== null) {
    if (inRange(mapped, LINK_LOCAL.base, LINK_LOCAL.prefix)) return true;
    if (!opts.allowLoopback && inRange(mapped, LOOPBACK.base, LOOPBACK.prefix)) return true;
    return false;
  }

  if (isIpv6LinkLocal(groups)) return true;
  if (isIpv6Unspecified(groups)) return true;
  if (!opts.allowLoopback && isIpv6Loopback(groups)) return true;
  return false;
}

/** RFC1918 private ranges (and their IPv6 unique-local equivalent, fc00::/7) — deliberately a
 * SEPARATE check from isBlockedAddress, not folded into it: device checks (httpChecker etc.) must
 * be able to reach 10/8, 172.16/12, 192.168/16 — that's the LAN this product monitors. A
 * notification webhook has no such legitimate use case; it's meant to reach an external alerting
 * endpoint, so callers for that use case (see adapters/notify/webhookNotifier.ts) should call this
 * in addition to isBlockedAddress. */
export function isPrivateAddress(ip: string): boolean {
  const ipInt = ipToInt(ip);
  if (ipInt !== null) return PRIVATE_RANGES.some((r) => inRange(ipInt, r.base, r.prefix));

  const groups = expandIpv6(ip);
  if (groups === null) return false;

  const mapped = embeddedIpv4(groups);
  if (mapped !== null) return PRIVATE_RANGES.some((r) => inRange(mapped, r.base, r.prefix));

  return isIpv6UniqueLocal(groups);
}

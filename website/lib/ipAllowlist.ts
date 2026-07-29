// Self-contained (no import from src/domain — see lib/license.ts's header comment for why: this
// Vercel project's root is website/, so a relative import reaching outside it wouldn't be included
// in the deployed function). IPv4-only, exact address or CIDR — the admin allowlist is meant to be
// a short, hand-maintained list of real office/home IPs, not something that needs IPv6 or dynamic
// range logic.
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

function matchesEntry(ip: string, entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  const ipInt = ipToInt(ip);
  if (ipInt === null) return false;

  if (trimmed.includes("/")) {
    const [base, prefixStr] = trimmed.split("/");
    const baseInt = ipToInt(base!);
    const prefix = Number(prefixStr);
    if (baseInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  }

  return ipInt === ipToInt(trimmed);
}

/** Parses ADMIN_ALLOWED_IPS ("1.2.3.4, 10.0.0.0/24, ..."). Empty/unset means "not configured" —
 * callers should fail closed in that case, not treat it as "allow everyone". */
export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedIp(ip: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => matchesEntry(ip, entry));
}

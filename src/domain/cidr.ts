// Pure CIDR math — no I/O. Caps subnet size at /22 (1024 addresses) to protect the scanning host.

export const MIN_PREFIX_LEN = 22; // smaller number = bigger subnet; /22 is the largest we allow

export interface ParsedCidr {
  networkInt: number;
  prefixLen: number;
  hostCount: number;
}

function ipToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`Invalid IPv4 address: ${ip}`);
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export class InvalidCidrError extends Error {}

export function parseCidr(cidr: string): ParsedCidr {
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) throw new InvalidCidrError(`Malformed CIDR: "${cidr}". Expected e.g. 192.168.1.0/24`);
  const [, ipStr, prefixStr] = match;
  const prefixLen = Number(prefixStr);
  if (prefixLen < 0 || prefixLen > 32) throw new InvalidCidrError(`Prefix length out of range: /${prefixLen}`);
  if (prefixLen < MIN_PREFIX_LEN) {
    throw new InvalidCidrError(
      `Subnet too large: /${prefixLen} exceeds the /${MIN_PREFIX_LEN} cap (max ${2 ** (32 - MIN_PREFIX_LEN)} addresses) to protect this host.`
    );
  }

  let networkInt: number;
  try {
    networkInt = ipToInt(ipStr!);
  } catch {
    throw new InvalidCidrError(`Malformed CIDR: "${cidr}"`);
  }

  const hostBits = 32 - prefixLen;
  const mask = hostBits === 0 ? 0xffffffff : (0xffffffff << hostBits) >>> 0;
  networkInt = networkInt & mask;
  const hostCount = 2 ** hostBits;

  return { networkInt, prefixLen, hostCount };
}

/** Enumerates usable host addresses (excludes network + broadcast for subnets with >2 addresses). */
export function listHosts(cidr: string): string[] {
  const { networkInt, hostCount } = parseCidr(cidr);
  if (hostCount <= 2) {
    return Array.from({ length: hostCount }, (_, i) => intToIp((networkInt + i) >>> 0));
  }
  const hosts: string[] = [];
  for (let i = 1; i < hostCount - 1; i++) {
    hosts.push(intToIp((networkInt + i) >>> 0));
  }
  return hosts;
}

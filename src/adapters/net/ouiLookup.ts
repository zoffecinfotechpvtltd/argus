import ouiData from "./oui-data.json";

const table = ouiData as Record<string, string>;

/** Offline vendor lookup from a MAC address. No network access — bundled at build time. */
export function lookupVendor(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const normalized = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (normalized.length < 6) return null;
  const prefix = normalized.slice(0, 6);
  return table[prefix] ?? null;
}

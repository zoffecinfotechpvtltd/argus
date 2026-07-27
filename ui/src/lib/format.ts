/** Auto-scales a raw bits-per-second reading (what @adapters/net/snmpMetrics.ts's if{N}.inBps /
 * if{N}.outBps store) to the nearest human unit. Shared between the Bandwidth page and the
 * dashboard's bandwidth summary card so the two never drift on formatting. */
export function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
  return `${Math.round(bps)} bps`;
}

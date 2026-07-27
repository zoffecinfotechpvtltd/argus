// Pure statistics helpers shared by the metric repo adapters. Kept framework-free so both the
// SQLite adapter (which has to compute this in JS — bun:sqlite has no percentile aggregate) and
// tests can use the exact same algorithm that Postgres's percentile_cont uses natively, so the two
// backends agree on the same input.

/**
 * Linear-interpolation ("continuous") percentile, matching PostgreSQL's `percentile_cont` and
 * numpy's default `linear` method. `sortedAsc` must already be sorted ascending.
 */
export function percentileContinuous(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (p <= 0) return sortedAsc[0]!;
  if (p >= 1) return sortedAsc[n - 1]!;
  if (n === 1) return sortedAsc[0]!;

  const rank = p * (n - 1);
  const lowerIdx = Math.floor(rank);
  const upperIdx = Math.ceil(rank);
  if (lowerIdx === upperIdx) return sortedAsc[lowerIdx]!;

  const weight = rank - lowerIdx;
  return sortedAsc[lowerIdx]! + (sortedAsc[upperIdx]! - sortedAsc[lowerIdx]!) * weight;
}

/** 95th-percentile convenience wrapper — the stat used for "typical peak" bandwidth reporting. */
export function percentile95(sortedAsc: number[]): number | null {
  return percentileContinuous(sortedAsc, 0.95);
}

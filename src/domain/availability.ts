// Pure — no I/O. Availability/SLA math. "Down" time is time spent in the DOWN state specifically;
// DEGRADED/FLAPPING count as up for SLA purposes (matches common NMS convention).

export interface DowntimeInterval {
  startedAt: string;
  endedAt: string | null; // null = still ongoing
}

function clampMs(iso: string, min: number, max: number): number {
  const ms = new Date(iso).getTime();
  return Math.min(Math.max(ms, min), max);
}

/** Sums the portion of each down interval that overlaps [periodStart, periodEnd]. */
export function totalDownMs(intervals: DowntimeInterval[], periodStartIso: string, periodEndIso: string, nowIso: string): number {
  const periodStart = new Date(periodStartIso).getTime();
  const periodEnd = new Date(periodEndIso).getTime();
  let total = 0;

  for (const interval of intervals) {
    const start = clampMs(interval.startedAt, periodStart, periodEnd);
    const endIso = interval.endedAt ?? nowIso;
    const end = clampMs(endIso, periodStart, periodEnd);
    if (end > start) total += end - start;
  }
  return total;
}

export function availabilityPct(periodMs: number, downMs: number): number {
  if (periodMs <= 0) return 100;
  const pct = ((periodMs - downMs) / periodMs) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

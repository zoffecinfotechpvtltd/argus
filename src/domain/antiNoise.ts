// Pure — no I/O, no Date.now(). Anti-noise decisions for the alert engine: per-device notification
// rate limiting and global "storm" detection (many devices going down at once, e.g. an uplink failure).

/** True if `maxCount` notifications have already been sent for this device within `windowMs`. */
export function isRateLimited(sentTimestampsMs: number[], nowMs: number, windowMs: number, maxCount: number): boolean {
  const recent = sentTimestampsMs.filter((t) => nowMs - t < windowMs);
  return recent.length >= maxCount;
}

/** True if more than `threshold` devices have gone down within `windowMs` — a likely shared-infrastructure outage. */
export function isStorm(downEventTimestampsMs: number[], nowMs: number, windowMs: number, threshold: number): boolean {
  const recent = downEventTimestampsMs.filter((t) => nowMs - t <= windowMs);
  return recent.length > threshold;
}

export function mostCommonGroupId(groupIds: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const g of groupIds) {
    if (g === null) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [g, c] of counts) {
    if (c > bestCount) {
      best = g;
      bestCount = c;
    }
  }
  return best;
}

// Adaptive polling tiers — how urgently a device should be re-checked, based on its current
// health rather than only its configured intervalSec. An unhealthy device is polled more often so
// a recovery (or a worsening) is caught quickly; a device that's been rock-solid for a long
// stretch is polled less often so it doesn't compete for concurrency slots with devices that
// actually need attention. Purely a scheduling nicety — it never changes failsToDown/okToUp
// semantics, alerting, or state evaluation (see stateMachine.ts for those).
import type { DeviceState } from "./entities";

export type PollTier = "fast" | "normal" | "relaxed";

const TIER_MULTIPLIER: Record<PollTier, number> = {
  fast: 0.5,
  normal: 1,
  relaxed: 2,
};

// A device must have been continuously "up" (no state change) for at least this long before it's
// eligible to drop into the relaxed tier.
export const RELAXED_STABLE_MS = 30 * 60_000;

// Cap on how far the relaxed tier can stretch a single device's effective interval, so a
// long-configured intervalSec doesn't balloon into a multi-hour blind spot once a device qualifies.
export const RELAXED_MAX_INTERVAL_MS = 10 * 60_000;

const JITTER_FRACTION = 0.1;
const MIN_INTERVAL_MS = 1000;

/** Picks the polling tier for a device given its current state and how long it's held that state. */
export function pollTierFor(state: DeviceState, sinceIso: string, nowMs: number): PollTier {
  if (state === "down" || state === "degraded" || state === "flapping") return "fast";
  if (state === "up") {
    const stableForMs = nowMs - new Date(sinceIso).getTime();
    if (stableForMs >= RELAXED_STABLE_MS) return "relaxed";
  }
  return "normal";
}

/**
 * Effective next-poll delay (ms) for a device's configured intervalSec at a given tier, with
 * +/-10% jitter (so a fleet of devices sharing an interval doesn't all wake up in lockstep).
 * `jitterSample` defaults to a fresh random draw in [-1, 1]; tests pass a fixed value for
 * deterministic assertions.
 */
export function tieredIntervalMs(intervalSec: number, tier: PollTier, jitterSample: number = Math.random() * 2 - 1): number {
  const scaledBase = intervalSec * 1000 * TIER_MULTIPLIER[tier];
  const capped = tier === "relaxed" ? Math.min(scaledBase, RELAXED_MAX_INTERVAL_MS) : scaledBase;
  const jittered = capped + capped * JITTER_FRACTION * jitterSample;
  return Math.max(MIN_INTERVAL_MS, Math.round(jittered));
}

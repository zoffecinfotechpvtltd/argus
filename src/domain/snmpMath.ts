// Pure SNMP counter math — no I/O. Handles 32-bit (and optionally 64-bit) counter wraparound.

export interface CounterSample {
  value: number;
  atMs: number;
}

/**
 * Computes a rate (units of `value` per second) between two counter samples, correctly handling
 * a single wraparound (counter reset to 0 and continued counting past it, e.g. ifInOctets on a
 * busy 32-bit interface). Returns null if the samples are out of order or the interval is zero.
 */
export function counterDeltaPerSecond(prev: CounterSample, curr: CounterSample, counterBits: 32 | 64 = 32): number | null {
  const intervalMs = curr.atMs - prev.atMs;
  if (intervalMs <= 0) return null;

  const modulus = counterBits === 32 ? 2 ** 32 : 2 ** 64;
  let delta = curr.value - prev.value;
  if (delta < 0) {
    // Counter wrapped exactly once (the common case for a poll interval short enough that it
    // can't wrap twice). Add the full range back so the delta reflects true traffic.
    delta += modulus;
  }

  return delta / (intervalMs / 1000);
}

/** ifInOctets/ifOutOctets deltas, in bytes/sec, converted to bits/sec (the conventional bandwidth unit). */
export function bandwidthBitsPerSecond(prevOctets: CounterSample, currOctets: CounterSample, counterBits: 32 | 64 = 32): number | null {
  const bytesPerSec = counterDeltaPerSecond(prevOctets, currOctets, counterBits);
  return bytesPerSec === null ? null : bytesPerSec * 8;
}

import { describe, expect, it } from "bun:test";
import { bandwidthBitsPerSecond, counterDeltaPerSecond } from "@domain/snmpMath";

describe("counterDeltaPerSecond", () => {
  it("computes a normal (non-wrapped) rate", () => {
    const prev = { value: 1_000_000, atMs: 0 };
    const curr = { value: 1_600_000, atMs: 60_000 };
    expect(counterDeltaPerSecond(prev, curr)).toBeCloseTo(10_000, 5); // 600,000 / 60s
  });

  it("handles a single 32-bit counter wraparound", () => {
    const modulus32 = 2 ** 32;
    const prev = { value: 4_294_967_200, atMs: 0 }; // near the 32-bit max
    const curr = { value: 100, atMs: 60_000 }; // wrapped past 0
    const expectedDelta = 100 + modulus32 - 4_294_967_200; // = 196
    expect(counterDeltaPerSecond(prev, curr)).toBeCloseTo(expectedDelta / 60, 5);
  });

  it("handles a 64-bit counter wraparound when explicitly requested", () => {
    const modulus64 = 2 ** 64;
    const prev = { value: modulus64 - 500, atMs: 0 };
    const curr = { value: 300, atMs: 10_000 };
    const expectedDelta = 300 + modulus64 - (modulus64 - 500); // = 800
    expect(counterDeltaPerSecond(prev, curr, 64)).toBeCloseTo(expectedDelta / 10, 5);
  });

  it("returns null when the interval is zero or negative (out-of-order samples)", () => {
    expect(counterDeltaPerSecond({ value: 100, atMs: 1000 }, { value: 200, atMs: 1000 })).toBeNull();
    expect(counterDeltaPerSecond({ value: 100, atMs: 1000 }, { value: 200, atMs: 500 })).toBeNull();
  });
});

describe("bandwidthBitsPerSecond", () => {
  it("converts a byte-counter rate to bits/sec", () => {
    const prev = { value: 0, atMs: 0 };
    const curr = { value: 125_000, atMs: 1000 }; // 125,000 bytes/sec
    expect(bandwidthBitsPerSecond(prev, curr)).toBeCloseTo(1_000_000, 3); // 1 Mbps
  });

  it("still handles wraparound when computing bandwidth", () => {
    const modulus32 = 2 ** 32;
    const prev = { value: modulus32 - 1000, atMs: 0 };
    const curr = { value: 0, atMs: 8000 };
    const expectedBytesPerSec = 1000 / 8;
    expect(bandwidthBitsPerSecond(prev, curr)).toBeCloseTo(expectedBytesPerSec * 8, 3);
  });
});

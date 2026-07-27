import { describe, expect, it } from "bun:test";
import { percentileContinuous, percentile95 } from "@domain/metricsMath";

describe("percentileContinuous", () => {
  it("returns null for an empty series", () => {
    expect(percentileContinuous([], 0.95)).toBeNull();
  });

  it("returns the single value for a one-element series regardless of p", () => {
    expect(percentileContinuous([42], 0.95)).toBe(42);
    expect(percentileContinuous([42], 0)).toBe(42);
    expect(percentileContinuous([42], 1)).toBe(42);
  });

  it("interpolates linearly, matching Postgres's percentile_cont", () => {
    // 1..10: p95 rank = 0.95*9 = 8.55 -> interpolate between index 8 (9) and 9 (10) at weight .55
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileContinuous(values, 0.95)).toBeCloseTo(9.55, 6);
  });

  it("returns the median for p=0.5 on an even-length series (average of the two middle values)", () => {
    expect(percentileContinuous([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 6);
  });

  it("clamps p<=0 to the minimum and p>=1 to the maximum", () => {
    const values = [10, 20, 30];
    expect(percentileContinuous(values, 0)).toBe(10);
    expect(percentileContinuous(values, 1)).toBe(30);
  });
});

describe("percentile95", () => {
  it("shrugs off a single spike better than max() would", () => {
    const values = Array.from({ length: 99 }, () => 100).concat([10_000]).sort((a, b) => a - b);
    const p95 = percentile95(values)!;
    expect(p95).toBeCloseTo(100, 1); // the one spike doesn't drag p95 up
    expect(p95).toBeLessThan(Math.max(...values));
  });
});

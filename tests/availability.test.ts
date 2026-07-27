import { describe, expect, it } from "bun:test";
import { availabilityPct, totalDownMs } from "@domain/availability";

describe("availabilityPct", () => {
  it("matches the hand-computed fixture: 36 min down in 24h = 97.5%", () => {
    const periodMs = 24 * 60 * 60 * 1000;
    const downMs = 36 * 60 * 1000;
    expect(availabilityPct(periodMs, downMs)).toBe(97.5);
  });

  it("is 100% with zero downtime", () => {
    expect(availabilityPct(24 * 60 * 60 * 1000, 0)).toBe(100);
  });

  it("is 0% when down for the entire period", () => {
    expect(availabilityPct(1000, 1000)).toBe(0);
  });

  it("clamps to [0,100] even with pathological input", () => {
    expect(availabilityPct(1000, 5000)).toBe(0);
  });
});

describe("totalDownMs", () => {
  const dayStart = "2026-01-01T00:00:00.000Z";
  const dayEnd = "2026-01-02T00:00:00.000Z";
  const now = "2026-01-02T00:00:00.000Z";

  it("sums a single interval fully inside the period", () => {
    const intervals = [{ startedAt: "2026-01-01T10:00:00.000Z", endedAt: "2026-01-01T10:36:00.000Z" }];
    expect(totalDownMs(intervals, dayStart, dayEnd, now)).toBe(36 * 60 * 1000);
  });

  it("clips an interval that starts before the period", () => {
    const intervals = [{ startedAt: "2025-12-31T23:50:00.000Z", endedAt: "2026-01-01T00:10:00.000Z" }];
    expect(totalDownMs(intervals, dayStart, dayEnd, now)).toBe(10 * 60 * 1000);
  });

  it("treats a still-open interval (endedAt null) as ongoing until `now`", () => {
    const intervals = [{ startedAt: "2026-01-01T23:50:00.000Z", endedAt: null }];
    expect(totalDownMs(intervals, dayStart, dayEnd, now)).toBe(10 * 60 * 1000);
  });

  it("sums multiple non-overlapping intervals", () => {
    const intervals = [
      { startedAt: "2026-01-01T01:00:00.000Z", endedAt: "2026-01-01T01:10:00.000Z" },
      { startedAt: "2026-01-01T05:00:00.000Z", endedAt: "2026-01-01T05:26:00.000Z" },
    ];
    expect(totalDownMs(intervals, dayStart, dayEnd, now)).toBe(36 * 60 * 1000);
  });

  it("ignores intervals entirely outside the period", () => {
    const intervals = [{ startedAt: "2025-01-01T00:00:00.000Z", endedAt: "2025-01-01T01:00:00.000Z" }];
    expect(totalDownMs(intervals, dayStart, dayEnd, now)).toBe(0);
  });
});

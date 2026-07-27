import { describe, expect, it } from "bun:test";
import { pollTierFor, tieredIntervalMs, RELAXED_STABLE_MS, RELAXED_MAX_INTERVAL_MS } from "@domain/pollTiers";

describe("pollTierFor", () => {
  const now = 1_000_000_000;

  it("puts down/degraded/flapping devices in the fast tier regardless of how long they've held that state", () => {
    expect(pollTierFor("down", new Date(now).toISOString(), now)).toBe("fast");
    expect(pollTierFor("degraded", new Date(now - 1).toISOString(), now)).toBe("fast");
    expect(pollTierFor("flapping", new Date(now - RELAXED_STABLE_MS * 10).toISOString(), now)).toBe("fast");
  });

  it("keeps a freshly-up device in the normal tier", () => {
    expect(pollTierFor("up", new Date(now).toISOString(), now)).toBe("normal");
    expect(pollTierFor("up", new Date(now - RELAXED_STABLE_MS + 1).toISOString(), now)).toBe("normal");
  });

  it("moves a device that's been up for the relaxed threshold into the relaxed tier", () => {
    expect(pollTierFor("up", new Date(now - RELAXED_STABLE_MS).toISOString(), now)).toBe("relaxed");
    expect(pollTierFor("up", new Date(now - RELAXED_STABLE_MS * 5).toISOString(), now)).toBe("relaxed");
  });

  it("treats maintenance as normal tier (no need to poll harder while alerts are suppressed anyway)", () => {
    expect(pollTierFor("maintenance", new Date(now - RELAXED_STABLE_MS * 5).toISOString(), now)).toBe("normal");
  });
});

describe("tieredIntervalMs", () => {
  it("halves the base interval for the fast tier", () => {
    expect(tieredIntervalMs(60, "fast", 0)).toBe(30_000);
  });

  it("keeps the base interval for the normal tier", () => {
    expect(tieredIntervalMs(60, "normal", 0)).toBe(60_000);
  });

  it("doubles the base interval for the relaxed tier, capped at RELAXED_MAX_INTERVAL_MS", () => {
    expect(tieredIntervalMs(60, "relaxed", 0)).toBe(120_000);
    expect(tieredIntervalMs(600, "relaxed", 0)).toBe(RELAXED_MAX_INTERVAL_MS); // 1200s*2 would exceed the cap
  });

  it("applies +/-10% jitter around the tiered base", () => {
    expect(tieredIntervalMs(100, "normal", 1)).toBe(110_000); // full positive jitter sample
    expect(tieredIntervalMs(100, "normal", -1)).toBe(90_000); // full negative jitter sample
  });

  it("never returns less than the 1s floor even for tiny intervals", () => {
    expect(tieredIntervalMs(1, "fast", -1)).toBeGreaterThanOrEqual(1000);
  });
});

import { describe, expect, it } from "bun:test";
import { isWithinQuietHours, meetsSeverityFloor, shouldNotifyNow } from "@domain/notificationPolicy";
import { isRateLimited, isStorm, mostCommonGroupId } from "@domain/antiNoise";

describe("meetsSeverityFloor", () => {
  it("allows equal or higher severity", () => {
    expect(meetsSeverityFloor("warning", "warning")).toBe(true);
    expect(meetsSeverityFloor("critical", "warning")).toBe(true);
  });
  it("blocks lower severity", () => {
    expect(meetsSeverityFloor("info", "warning")).toBe(false);
  });
});

describe("isWithinQuietHours", () => {
  it("handles a same-day window", () => {
    expect(isWithinQuietHours("13:00", "09:00", "17:00")).toBe(true);
    expect(isWithinQuietHours("08:00", "09:00", "17:00")).toBe(false);
  });
  it("handles an overnight window", () => {
    expect(isWithinQuietHours("23:30", "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours("03:00", "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours("12:00", "22:00", "07:00")).toBe(false);
  });
});

describe("shouldNotifyNow", () => {
  it("always notifies for critical severity, even during quiet hours", () => {
    expect(
      shouldNotifyNow({ severity: "critical", severityFloor: "info", quietHoursStart: "22:00", quietHoursEnd: "07:00", nowHHMM: "23:00" })
    ).toBe(true);
  });
  it("suppresses warning severity during quiet hours", () => {
    expect(
      shouldNotifyNow({ severity: "warning", severityFloor: "info", quietHoursStart: "22:00", quietHoursEnd: "07:00", nowHHMM: "23:00" })
    ).toBe(false);
  });
  it("respects the severity floor regardless of quiet hours", () => {
    expect(shouldNotifyNow({ severity: "info", severityFloor: "warning", quietHoursStart: null, quietHoursEnd: null, nowHHMM: "12:00" })).toBe(
      false
    );
  });
});

describe("isRateLimited", () => {
  it("is false until maxCount is reached within the window", () => {
    const now = 100_000;
    const history = [now - 1000, now - 2000, now - 3000];
    expect(isRateLimited(history, now, 3_600_000, 4)).toBe(false);
  });
  it("is true once maxCount is reached within the window", () => {
    const now = 100_000;
    const history = [now - 1000, now - 2000, now - 3000, now - 4000];
    expect(isRateLimited(history, now, 3_600_000, 4)).toBe(true);
  });
  it("ignores entries outside the window", () => {
    const now = 3_700_000;
    const history = [0, 1000, 2000, 3000]; // all older than 3,600,000ms window
    expect(isRateLimited(history, now, 3_600_000, 4)).toBe(false);
  });
});

describe("isStorm", () => {
  it("is false at or below the threshold", () => {
    const now = 100_000;
    const timestamps = Array.from({ length: 20 }, (_, i) => now - i * 100);
    expect(isStorm(timestamps, now, 60_000, 20)).toBe(false);
  });
  it("is true above the threshold", () => {
    const now = 100_000;
    const timestamps = Array.from({ length: 21 }, (_, i) => now - i * 100);
    expect(isStorm(timestamps, now, 60_000, 20)).toBe(true);
  });
});

describe("mostCommonGroupId", () => {
  it("returns the most frequent non-null group", () => {
    expect(mostCommonGroupId(["a", "b", "a", "a", null, "b"])).toBe("a");
  });
  it("returns null when there are no groups", () => {
    expect(mostCommonGroupId([null, null])).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { getOnCallUserId } from "@domain/onCall";
import type { OnCallSchedule } from "@domain/entities";

function schedule(overrides: Partial<OnCallSchedule> = {}): OnCallSchedule {
  return {
    id: "s1",
    tenantId: "t1",
    groupId: "g1",
    userIds: ["u1", "u2", "u3"],
    shiftLengthHours: 24,
    rotationStartAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getOnCallUserId", () => {
  test("first person holds the first shift", () => {
    expect(getOnCallUserId(schedule(), "2026-01-01T00:00:00.000Z")).toBe("u1");
    expect(getOnCallUserId(schedule(), "2026-01-01T12:00:00.000Z")).toBe("u1");
  });

  test("rotates to the next person after one shift length", () => {
    expect(getOnCallUserId(schedule(), "2026-01-02T00:00:00.000Z")).toBe("u2");
    expect(getOnCallUserId(schedule(), "2026-01-02T23:59:59.000Z")).toBe("u2");
  });

  test("wraps back to the first person after a full cycle", () => {
    expect(getOnCallUserId(schedule(), "2026-01-04T00:00:00.000Z")).toBe("u1");
  });

  test("before rotationStartAt, the first person is on call", () => {
    expect(getOnCallUserId(schedule(), "2025-12-31T00:00:00.000Z")).toBe("u1");
  });

  test("null when the schedule has no members", () => {
    expect(getOnCallUserId(schedule({ userIds: [] }), "2026-01-05T00:00:00.000Z")).toBeNull();
  });

  test("single-member rotation always returns that member", () => {
    expect(getOnCallUserId(schedule({ userIds: ["solo"] }), "2026-06-01T00:00:00.000Z")).toBe("solo");
  });
});

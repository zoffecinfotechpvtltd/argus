import { describe, expect, test } from "bun:test";
import { compareVersions, isNewerVersion } from "@domain/semver";

describe("compareVersions", () => {
  test("equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
  test("major/minor/patch ordering", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
  });
  test("tolerates a leading v and missing parts", () => {
    expect(compareVersions("v1.2.0", "1.2")).toBe(0);
  });
});

describe("isNewerVersion", () => {
  test("true when latest > current", () => {
    expect(isNewerVersion("1.1.0", "1.0.0")).toBe(true);
  });
  test("false when equal or older", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
  });
});

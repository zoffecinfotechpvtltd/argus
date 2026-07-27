import { describe, expect, it } from "bun:test";
import { isBlockedAddress } from "@domain/ssrfGuard";

describe("isBlockedAddress", () => {
  it("blocks the link-local range, including the cloud metadata endpoint", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
    expect(isBlockedAddress("169.254.255.255")).toBe(true);
  });

  it("blocks loopback by default", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("127.10.20.30")).toBe(true);
  });

  it("allows loopback when explicitly opted in", () => {
    expect(isBlockedAddress("127.0.0.1", { allowLoopback: true })).toBe(false);
  });

  it("never blocks private RFC1918 ranges — monitoring the LAN is the whole point", () => {
    expect(isBlockedAddress("192.168.1.1")).toBe(false);
    expect(isBlockedAddress("10.0.0.1")).toBe(false);
    expect(isBlockedAddress("172.16.0.1")).toBe(false);
  });

  it("never blocks ordinary public addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
  });

  it("does not block link-local even with allowLoopback set", () => {
    expect(isBlockedAddress("169.254.1.1", { allowLoopback: true })).toBe(true);
  });
});

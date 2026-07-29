import { describe, expect, it } from "bun:test";
import { isBlockedAddress, isPrivateAddress } from "@domain/ssrfGuard";

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

// Regression coverage: earlier versions of the SSRF-guard callers (webhookNotifier.ts,
// generalSettings.ts's assertSafeUpdateUrl) only ever passed IPv4 addresses to isBlockedAddress
// (skipping anything with a different `family` from Node's dns.lookup), so a hostname resolving
// only to an IPv6 address sailed through completely unchecked. isBlockedAddress/isPrivateAddress
// now understand IPv6 literals directly, so callers no longer need to filter by family at all.
describe("isBlockedAddress (IPv6)", () => {
  it("blocks the IPv6 loopback address", () => {
    expect(isBlockedAddress("::1")).toBe(true);
  });

  it("allows IPv6 loopback when explicitly opted in", () => {
    expect(isBlockedAddress("::1", { allowLoopback: true })).toBe(false);
  });

  it("blocks the IPv6 link-local range (fe80::/10)", () => {
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("fe80::a1b2:c3d4:e5f6:1234")).toBe(true);
    expect(isBlockedAddress("febf:ffff::1")).toBe(true);
    expect(isBlockedAddress("fec0::1")).toBe(false); // just outside the /10
  });

  it("blocks the unspecified address ::", () => {
    expect(isBlockedAddress("::")).toBe(true);
  });

  it("sees through an IPv4-mapped IPv6 address to the embedded IPv4", () => {
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true); // mapped cloud metadata IP
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true); // mapped loopback
    expect(isBlockedAddress("::ffff:127.0.0.1", { allowLoopback: true })).toBe(false);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false); // mapped ordinary public address
  });

  it("never blocks an ordinary public IPv6 address", () => {
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false); // Google public DNS
  });

  it("does not misparse a non-address string as IPv6", () => {
    expect(isBlockedAddress("not-an-address")).toBe(false);
    expect(isBlockedAddress("evil.example.com")).toBe(false);
  });
});

describe("isPrivateAddress (IPv6)", () => {
  it("blocks the unique-local range (fc00::/7), IPv6's RFC1918 equivalent", () => {
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456:789a::1")).toBe(true);
    expect(isPrivateAddress("fe00::1")).toBe(false); // just outside the /7
  });

  it("sees through an IPv4-mapped IPv6 address to the embedded private IPv4", () => {
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("never blocks an ordinary public IPv6 address", () => {
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
});

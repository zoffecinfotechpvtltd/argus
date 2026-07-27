import { describe, expect, it } from "bun:test";
import { parseCidr, listHosts, InvalidCidrError } from "@domain/cidr";

describe("parseCidr", () => {
  it("parses a /24 correctly", () => {
    const r = parseCidr("192.168.1.50/24");
    expect(r.prefixLen).toBe(24);
    expect(r.hostCount).toBe(256);
  });

  it("rejects subnets larger than /22", () => {
    expect(() => parseCidr("10.0.0.0/16")).toThrow(InvalidCidrError);
  });

  it("accepts exactly /22", () => {
    expect(() => parseCidr("10.0.0.0/22")).not.toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => parseCidr("not-a-cidr")).toThrow(InvalidCidrError);
    expect(() => parseCidr("999.1.1.1/24")).toThrow(InvalidCidrError);
  });
});

describe("listHosts", () => {
  it("excludes network and broadcast for a /30", () => {
    const hosts = listHosts("192.168.1.0/30");
    expect(hosts).toEqual(["192.168.1.1", "192.168.1.2"]);
  });

  it("produces 254 usable hosts for a /24", () => {
    const hosts = listHosts("192.168.1.0/24");
    expect(hosts.length).toBe(254);
    expect(hosts[0]).toBe("192.168.1.1");
    expect(hosts[hosts.length - 1]).toBe("192.168.1.254");
  });
});

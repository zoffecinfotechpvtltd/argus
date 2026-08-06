import { describe, expect, it } from "bun:test";
import { buildDefaultChecks } from "@domain/defaultChecks";

describe("buildDefaultChecks", () => {
  const base = { tenantId: "local", deviceId: "dev-1", nowIso: "2026-01-01T00:00:00.000Z", hasVendorApi: false };

  it("always includes an ICMP check", () => {
    const checks = buildDefaultChecks({ ...base, hasHttp: false, hasHttps: false, hasSnmp: false });
    expect(checks.map((c) => c.kind)).toEqual(["icmp"]);
  });

  it("adds an HTTP check when port 80 was seen", () => {
    const checks = buildDefaultChecks({ ...base, hasHttp: true, hasHttps: false, hasSnmp: false });
    expect(checks.map((c) => c.kind)).toEqual(["icmp", "http"]);
    expect(checks[1]?.config.port).toBe(80);
    expect(checks[1]?.config.tls).toBe(false);
  });

  it("prefers HTTPS (443) over HTTP when both are seen", () => {
    const checks = buildDefaultChecks({ ...base, hasHttp: true, hasHttps: true, hasSnmp: false });
    const http = checks.find((c) => c.kind === "http");
    expect(http?.config.port).toBe(443);
    expect(http?.config.tls).toBe(true);
  });

  it("adds an SNMP check only when credentials are present", () => {
    const withCreds = buildDefaultChecks({ ...base, hasHttp: false, hasHttps: false, hasSnmp: true });
    expect(withCreds.map((c) => c.kind)).toEqual(["icmp", "snmp"]);

    const withoutCreds = buildDefaultChecks({ ...base, hasHttp: false, hasHttps: false, hasSnmp: false });
    expect(withoutCreds.map((c) => c.kind)).toEqual(["icmp"]);
  });

  it("can include all three checks at once", () => {
    const checks = buildDefaultChecks({ ...base, hasHttp: true, hasHttps: false, hasSnmp: true });
    expect(checks.map((c) => c.kind).sort()).toEqual(["http", "icmp", "snmp"]);
  });

  it("adds a fortigate_api check only when a vendor API is configured", () => {
    const withApi = buildDefaultChecks({ ...base, hasHttp: false, hasHttps: false, hasSnmp: false, hasVendorApi: true });
    expect(withApi.map((c) => c.kind)).toEqual(["icmp", "fortigate_api"]);

    const withoutApi = buildDefaultChecks({ ...base, hasHttp: false, hasHttps: false, hasSnmp: false, hasVendorApi: false });
    expect(withoutApi.map((c) => c.kind)).toEqual(["icmp"]);
  });

  it("every generated check belongs to the given tenant and device", () => {
    const checks = buildDefaultChecks({ ...base, hasHttp: true, hasHttps: true, hasSnmp: true });
    for (const c of checks) {
      expect(c.tenantId).toBe("local");
      expect(c.deviceId).toBe("dev-1");
      expect(c.enabled).toBe(true);
    }
  });
});

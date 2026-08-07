import { describe, expect, it, afterEach } from "bun:test";
import { SophosApiChecker } from "@adapters/net/checkers/sophosApiChecker";
import { encryptSecret } from "@adapters/crypto";
import { serializeSophosApiCredential } from "@domain/vendorApiCredential";
import { DEFAULT_TENANT_ID, type Check, type Device } from "@domain/entities";

const instanceKey = Buffer.alloc(32, 7);
const originalFetch = globalThis.fetch;

const SUCCESS_LOGIN = `<Response><Login><status>Authentication Successful</status></Login></Response>`;
const FAILED_LOGIN = `<Response><Login><status>Authentication Failure</status></Login><Status code="536">Authentication Failure</Status></Response>`;
const VPN_RESPONSE = `<Response>
  <VPNIPSecConnection><Name>hq-branch</Name><ConnectionStatus>Active</ConnectionStatus></VPNIPSecConnection>
  <VPNIPSecConnection><Name>hq-dr</Name><ConnectionStatus>Inactive</ConnectionStatus></VPNIPSecConnection>
</Response>`;

let lastReqXml = "";

/** Stubs fetch with a fake Sophos APIController: decodes the `reqxml` form field so tests can
 * assert on the actual XML sent (not its URL-encoded wire form), and routes by content the same
 * way a real Get-vs-Login request would differ. */
function stubFetch(opts: { loginFails?: boolean } = {}) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const raw = String(init?.body ?? "");
    const reqxml = new URLSearchParams(raw).get("reqxml") ?? "";
    lastReqXml = reqxml;
    if (opts.loginFails) return new Response(FAILED_LOGIN, { status: 200 });
    if (reqxml.includes("VPNIPSecConnection")) return new Response(VPN_RESPONSE, { status: 200 });
    return new Response(SUCCESS_LOGIN, { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  lastReqXml = "";
});

function makeDevice(overrides: Partial<Device> = {}): Device {
  const now = new Date().toISOString();
  return {
    id: "dev-1",
    tenantId: DEFAULT_TENANT_ID,
    name: "sophos-test",
    ip: "10.0.9.1",
    mac: null,
    vendor: null,
    type: "firewall",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: 60,
    enabled: true,
    snmpCredsEnc: null,
    tags: [],
    uplinkDeviceId: null,
    criticalAsset: false,
    model: null,
    firmwareVersion: null,
    serialNumber: null,
    haRole: null,
    apiVendor: "sophos",
    apiCredsEnc: null,
    remoteAgentId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCheck(config: Check["config"] = {}): Check {
  return {
    id: "chk-1",
    tenantId: DEFAULT_TENANT_ID,
    deviceId: "dev-1",
    kind: "sophos_api",
    config,
    thresholds: {},
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}

function credsFor(username: string, password: string): string {
  return encryptSecret(instanceKey, serializeSophosApiCredential({ username, password, verifyTls: false }));
}

describe("SophosApiChecker", () => {
  it("fails with no credentials configured", async () => {
    const checker = new SophosApiChecker(instanceKey);
    const result = await checker.run(makeDevice({ apiCredsEnc: null }), makeCheck());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no vendor api credentials/i);
  });

  it("succeeds and reports VPN tunnel status on a valid login", async () => {
    stubFetch();
    const checker = new SophosApiChecker(instanceKey);
    const device = makeDevice({ apiCredsEnc: credsFor("argus-api", "correct-password") });
    const result = await checker.run(device, makeCheck());

    expect(result.ok).toBe(true);
    expect(result.values?.vpnTunnelsTotal).toBe(2);
    expect(result.values?.vpnTunnelsUp).toBe(1);
  });

  it("fails with a readable reason when the login is rejected", async () => {
    stubFetch({ loginFails: true });
    const checker = new SophosApiChecker(instanceKey);
    const device = makeDevice({ apiCredsEnc: credsFor("argus-api", "bad-password") });
    const result = await checker.run(device, makeCheck());

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/login failed/i);
    expect(result.error).toContain("Authentication Failure");
  });

  it("XML-escapes credentials rather than interpolating them raw", async () => {
    stubFetch();
    const checker = new SophosApiChecker(instanceKey);
    const device = makeDevice({ apiCredsEnc: credsFor("argus-api", 'p&ss<word>"') });
    await checker.run(device, makeCheck());

    expect(lastReqXml).not.toContain("<word>");
    expect(lastReqXml).toContain("p&amp;ss&lt;word&gt;&quot;");
  });

  it("is blocked by the SSRF guard for a link-local target", async () => {
    stubFetch();
    const checker = new SophosApiChecker(instanceKey);
    const device = makeDevice({ ip: "169.254.1.1", apiCredsEnc: credsFor("argus-api", "correct-password") });
    const result = await checker.run(device, makeCheck());

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ssrf/i);
  });
});

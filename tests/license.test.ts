import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { createDevice } from "@application/devices/deviceUseCases";
import { importDiscoveredDevices } from "@application/discovery/importDiscoveredDevices";
import { LicenseLimitError } from "@application/license";
import { DEFAULT_TENANT_ID } from "@domain/entities";
import {
  effectiveDeviceLimit,
  encodeLicenseFile,
  TRIAL_DEVICE_LIMIT,
  verifyLicenseFile,
  type LicensePayload,
} from "@domain/license";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const OTHER_KEYPAIR = generateKeyPairSync("ed25519");
const OTHER_PUBLIC_KEY_PEM = OTHER_KEYPAIR.publicKey.export({ type: "spki", format: "pem" }).toString();

function issue(payload: LicensePayload): string {
  const signature = cryptoSign(null, Buffer.from(JSON.stringify(payload)), privateKey);
  return encodeLicenseFile(payload, signature);
}

function samplePayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    licenseId: "lic_1",
    customer: "Acme Corp",
    plan: "business",
    deviceLimit: 100,
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("verifyLicenseFile", () => {
  it("accepts a validly signed, unexpired license", () => {
    const raw = issue(samplePayload());
    const state = verifyLicenseFile(raw, PUBLIC_KEY_PEM, "2026-06-01T00:00:00.000Z");
    expect(state.status).toBe("valid");
    if (state.status === "valid") {
      expect(state.payload.customer).toBe("Acme Corp");
      expect(state.payload.deviceLimit).toBe(100);
    }
  });

  it("rejects a license signed with a different key", () => {
    const raw = issue(samplePayload());
    const state = verifyLicenseFile(raw, OTHER_PUBLIC_KEY_PEM, "2026-06-01T00:00:00.000Z");
    expect(state.status).toBe("invalid");
  });

  it("rejects a tampered payload even with an otherwise-valid signature", () => {
    const raw = issue(samplePayload());
    const [payloadB64, sig] = raw.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf-8"));
    payload.deviceLimit = 999999;
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    const state = verifyLicenseFile(tampered, PUBLIC_KEY_PEM, "2026-06-01T00:00:00.000Z");
    expect(state.status).toBe("invalid");
  });

  it("rejects malformed input", () => {
    expect(verifyLicenseFile("not-a-license-file", PUBLIC_KEY_PEM, "2026-06-01T00:00:00.000Z").status).toBe("invalid");
    expect(verifyLicenseFile("", PUBLIC_KEY_PEM, "2026-06-01T00:00:00.000Z").status).toBe("invalid");
  });

  it("returns grace status within the grace period after expiry", () => {
    const raw = issue(samplePayload({ expiresAt: "2027-01-01T00:00:00.000Z" }));
    const state = verifyLicenseFile(raw, PUBLIC_KEY_PEM, "2027-01-05T00:00:00.000Z");
    expect(state.status).toBe("grace");
    if (state.status === "grace") expect(state.graceDaysLeft).toBeGreaterThan(0);
  });

  it("returns expired status once past the grace period", () => {
    const raw = issue(samplePayload({ expiresAt: "2027-01-01T00:00:00.000Z" }));
    const state = verifyLicenseFile(raw, PUBLIC_KEY_PEM, "2027-02-01T00:00:00.000Z");
    expect(state.status).toBe("expired");
  });
});

describe("effectiveDeviceLimit", () => {
  it("uses the trial cap when unlicensed", () => {
    expect(effectiveDeviceLimit({ status: "unlicensed" })).toBe(TRIAL_DEVICE_LIMIT);
  });

  it("uses the trial cap when invalid", () => {
    expect(effectiveDeviceLimit({ status: "invalid", reason: "x" })).toBe(TRIAL_DEVICE_LIMIT);
  });

  it("uses the trial cap once past grace", () => {
    expect(effectiveDeviceLimit({ status: "expired", payload: samplePayload() })).toBe(TRIAL_DEVICE_LIMIT);
  });

  it("uses the license's device limit while valid", () => {
    expect(effectiveDeviceLimit({ status: "valid", payload: samplePayload({ deviceLimit: 250 }) })).toBe(250);
  });

  it("uses the license's device limit during grace", () => {
    expect(effectiveDeviceLimit({ status: "grace", payload: samplePayload({ deviceLimit: 250 }), graceDaysLeft: 3 })).toBe(250);
  });
});

describe("assertLicenseAllowsNewDevice", () => {
  it("allows devices up to the trial cap when unlicensed", async () => {
    const { app } = buildTestContainer({ license: { status: "unlicensed" } });
    for (let i = 0; i < TRIAL_DEVICE_LIMIT; i++) {
      await createDevice(app, DEFAULT_TENANT_ID, "u1", { name: `d${i}`, ip: `10.0.0.${i + 1}` });
    }
    await expect(createDevice(app, DEFAULT_TENANT_ID, "u1", { name: "over", ip: "10.0.0.99" })).rejects.toThrow(LicenseLimitError);
  });

  it("allows devices up to a valid license's device limit", async () => {
    const { app } = buildTestContainer({
      license: { status: "valid", payload: samplePayload({ deviceLimit: 2 }) },
    });
    await createDevice(app, DEFAULT_TENANT_ID, "u1", { name: "d1", ip: "10.0.0.1" });
    await createDevice(app, DEFAULT_TENANT_ID, "u1", { name: "d2", ip: "10.0.0.2" });
    await expect(createDevice(app, DEFAULT_TENANT_ID, "u1", { name: "d3", ip: "10.0.0.3" })).rejects.toThrow(LicenseLimitError);
  });

  it("blocks a bulk discovery import that would exceed the trial cap, and lands nothing", async () => {
    // Regression test: importDiscoveredDevices used to insert via a batch repo call that bypassed
    // assertLicenseAllowsNewDevice entirely (that check only ran on the single-device create path),
    // so an unlicensed trial install could import arbitrarily many devices at once via Discovery.
    const { app } = buildTestContainer({ license: { status: "unlicensed" } });

    const selections = Array.from({ length: TRIAL_DEVICE_LIMIT + 3 }, (_, i) => ({
      ip: `10.7.0.${i}`,
      type: "unknown" as const,
      openPorts: [] as number[],
    }));

    await expect(importDiscoveredDevices(app, DEFAULT_TENANT_ID, "u1", selections)).rejects.toThrow(LicenseLimitError);

    const page = await app.repos.device.list(DEFAULT_TENANT_ID);
    expect(page.total).toBe(0);
  });

  it("allows a bulk discovery import that fits within the trial cap", async () => {
    const { app } = buildTestContainer({ license: { status: "unlicensed" } });
    const selections = Array.from({ length: TRIAL_DEVICE_LIMIT }, (_, i) => ({ ip: `10.7.1.${i}`, type: "unknown" as const, openPorts: [] as number[] }));

    const result = await importDiscoveredDevices(app, DEFAULT_TENANT_ID, "u1", selections);
    expect(result.imported.length).toBe(TRIAL_DEVICE_LIMIT);
  });
});

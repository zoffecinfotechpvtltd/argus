// Shared license-signing logic used by both scripts/generate-license.ts (CLI) and
// scripts/license-admin.ts (local web UI) so the two entry points can never drift apart on how a
// license file actually gets built and signed.
import { randomUUID, sign as cryptoSign } from "node:crypto";
import { LICENSE_PLANS, PLAN_DEVICE_RANGES, type LicensePayload, type LicensePlan } from "../../src/domain/license";
import { encodeLicenseFile } from "../../src/domain/license";

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "customer"
  );
}

export function isLicensePlan(value: string): value is LicensePlan {
  return (LICENSE_PLANS as readonly string[]).includes(value);
}

export function perpetualExpiry(from: Date = new Date()): string {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 50);
  return d.toISOString();
}

export interface IssueLicenseInput {
  customer: string;
  plan: LicensePlan;
  devices: number;
  /** ISO expiry timestamp — callers resolve `--perpetual` / `--expires` to this before calling. */
  expiresAt: string;
  privateKeyPem: string;
}

export interface IssueLicenseResult {
  payload: LicensePayload;
  licenseFile: string;
}

/** Validates devices against the plan's sold device-range and rejects if outside it — catches the
 * "sold Starter, typed 500 devices" mistake at issue time rather than at the customer's desk. */
export function validateDevicesForPlan(plan: LicensePlan, devices: number): string | null {
  const range = PLAN_DEVICE_RANGES[plan];
  if (devices < range.min || (range.max !== null && devices > range.max)) {
    const maxLabel = range.max === null ? "no upper limit" : `up to ${range.max}`;
    return `${range.label} is sold for ${range.min}-${range.max ?? "∞"} devices (${maxLabel}); ${devices} is outside that range.`;
  }
  return null;
}

export function issueLicense(input: IssueLicenseInput): IssueLicenseResult {
  const payload: LicensePayload = {
    licenseId: randomUUID(),
    customer: input.customer,
    plan: input.plan,
    deviceLimit: input.devices,
    issuedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
  };

  const signature = cryptoSign(null, Buffer.from(JSON.stringify(payload), "utf-8"), input.privateKeyPem);
  const licenseFile = encodeLicenseFile(payload, signature);
  return { payload, licenseFile };
}

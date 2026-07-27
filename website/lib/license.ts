// Self-contained copy of the license-signing logic from ../../../src/domain/license.ts and
// ../../../scripts/lib/issueLicense.ts. Duplicated rather than imported: this Vercel project's
// Root Directory is `website/` (see ../GUIDE.md §9.6), so a relative import reaching
// outside that directory wouldn't be included in the serverless function's build. Both copies
// produce byte-identical license files (same payload shape, same ed25519 signing) — if the format
// ever changes in src/domain/license.ts, mirror the change here too.
import { randomUUID, sign as cryptoSign } from "node:crypto";

export type LicensePlan = "starter" | "professional" | "business" | "enterprise" | "unlimited";

export const LICENSE_PLANS: readonly LicensePlan[] = ["starter", "professional", "business", "enterprise", "unlimited"];

export const PLAN_DEVICE_RANGES: Record<LicensePlan, { label: string; min: number; max: number | null }> = {
  starter: { label: "Starter", min: 1, max: 25 },
  professional: { label: "Professional", min: 26, max: 100 },
  business: { label: "Business", min: 101, max: 500 },
  enterprise: { label: "Enterprise", min: 501, max: 2000 },
  unlimited: { label: "Unlimited", min: 2001, max: null },
};

export interface LicensePayload {
  licenseId: string;
  customer: string;
  plan: LicensePlan;
  deviceLimit: number;
  issuedAt: string;
  expiresAt: string;
}

export function isLicensePlan(value: string): value is LicensePlan {
  return (LICENSE_PLANS as readonly string[]).includes(value);
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "customer"
  );
}

export function perpetualExpiry(from: Date = new Date()): string {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 50);
  return d.toISOString();
}

export function validateDevicesForPlan(plan: LicensePlan, devices: number): string | null {
  const range = PLAN_DEVICE_RANGES[plan];
  if (devices < range.min || (range.max !== null && devices > range.max)) {
    const maxLabel = range.max === null ? "no upper limit" : `up to ${range.max}`;
    return `${range.label} is sold for ${range.min}-${range.max ?? "∞"} devices (${maxLabel}); ${devices} is outside that range.`;
  }
  return null;
}

function encodeLicenseFile(payload: LicensePayload, signature: Buffer): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${payloadB64}.${signature.toString("base64url")}`;
}

export interface IssueLicenseInput {
  customer: string;
  plan: LicensePlan;
  devices: number;
  expiresAt: string;
  privateKeyPem: string;
}

export interface IssueLicenseResult {
  payload: LicensePayload;
  licenseFile: string;
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

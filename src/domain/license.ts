// Pure domain logic for exe-mode licensing. NO imports from adapters/ or ports/ — this file must
// never touch I/O. Verification only needs a public key (safe to embed in source) and the license
// blob itself; signing happens offline, outside this app, with the private key (see
// scripts/generate-license.ts).
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

/** License tiers, shared across both deployment modes: exe (a signed file unlocks one of the
 * original five — see GUIDE.md §9.3) and saas (a tenant's `plan` column is one of
 * "free"/"pro"/"enterprise"). One vocabulary product-wide rather than two parallel tier
 * systems; "free"/"pro" were added alongside the original five (never renaming/removing them —
 * exe-mode license files already issued and signed against the original plan-name strings must
 * keep verifying exactly as before). */
export type LicensePlan = "starter" | "professional" | "business" | "enterprise" | "unlimited" | "free" | "pro";

export const LICENSE_PLANS: readonly LicensePlan[] = ["starter", "professional", "business", "enterprise", "unlimited", "free", "pro"];

/** Named device-count range each plan is sold at. `max: null` means no upper bound. Purely a
 * pricing/labeling aid — `LicensePayload.deviceLimit` is still the number actually enforced, so a
 * license always works even if these ranges are renumbered later. */
export const PLAN_DEVICE_RANGES: Record<LicensePlan, { label: string; min: number; max: number | null }> = {
  starter: { label: "Starter", min: 1, max: 25 },
  professional: { label: "Professional", min: 26, max: 100 },
  business: { label: "Business", min: 101, max: 500 },
  enterprise: { label: "Enterprise", min: 501, max: 2000 },
  unlimited: { label: "Unlimited", min: 2001, max: null },
  free: { label: "Free", min: 0, max: 50 },
  pro: { label: "Pro", min: 51, max: 1000 },
};

export interface LicensePayload {
  licenseId: string;
  customer: string;
  plan: LicensePlan;
  deviceLimit: number;
  issuedAt: string;
  /** ISO date. Far-future (e.g. +50y) is how a perpetual/one-time-purchase license is expressed —
   * there's no separate "perpetual" flag, just one mechanism for both sale types. */
  expiresAt: string;
}

export type LicenseState =
  | { status: "unlicensed" }
  | { status: "valid"; payload: LicensePayload }
  | { status: "grace"; payload: LicensePayload; graceDaysLeft: number }
  | { status: "expired"; payload: LicensePayload }
  | { status: "invalid"; reason: string };

/** No license file present: how many devices exe mode allows before a customer needs to buy one. */
export const TRIAL_DEVICE_LIMIT = 5;

/** Days after expiry a license keeps working at full capacity before dropping to "expired". Avoids
 * hard-locking a paying customer out over a missed renewal email. */
export const GRACE_PERIOD_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** License file format: "<base64url(json payload)>.<base64url(ed25519 signature)>" — the same
 * "<data>.<sig>" shape @adapters/crypto's HmacAckTokenSigner already uses elsewhere in this app. */
export function encodeLicenseFile(payload: LicensePayload, signature: Buffer): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${payloadB64}.${signature.toString("base64url")}`;
}

function decodeLicenseFile(raw: string): { payloadJson: string; payload: LicensePayload; signature: Buffer } | null {
  const trimmed = raw.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payloadB64, sigB64] = parts;
  let payloadJson: string;
  let payload: LicensePayload;
  try {
    payloadJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (
    typeof payload.licenseId !== "string" ||
    typeof payload.customer !== "string" ||
    typeof payload.plan !== "string" ||
    !LICENSE_PLANS.includes(payload.plan as LicensePlan) ||
    typeof payload.deviceLimit !== "number" ||
    typeof payload.issuedAt !== "string" ||
    typeof payload.expiresAt !== "string"
  ) {
    return null;
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  return { payloadJson, payload, signature };
}

/** Verifies a license file's signature and expiry against the given public key. Pure — takes
 * "now" as an argument rather than reading the clock itself. */
export function verifyLicenseFile(raw: string, publicKeyPem: string, nowIso: string): LicenseState {
  const decoded = decodeLicenseFile(raw);
  if (!decoded) return { status: "invalid", reason: "Malformed license file." };

  let signatureOk: boolean;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    signatureOk = cryptoVerify(null, Buffer.from(decoded.payloadJson, "utf-8"), publicKey, decoded.signature);
  } catch {
    return { status: "invalid", reason: "Could not verify license signature." };
  }
  if (!signatureOk) return { status: "invalid", reason: "License signature does not match — file was altered or issued for a different product." };

  const now = new Date(nowIso).getTime();
  const expiresAt = new Date(decoded.payload.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return { status: "invalid", reason: "License has an unreadable expiry date." };

  if (now <= expiresAt) return { status: "valid", payload: decoded.payload };

  const daysPastExpiry = (now - expiresAt) / MS_PER_DAY;
  if (daysPastExpiry <= GRACE_PERIOD_DAYS) {
    return { status: "grace", payload: decoded.payload, graceDaysLeft: Math.max(0, Math.ceil(GRACE_PERIOD_DAYS - daysPastExpiry)) };
  }
  return { status: "expired", payload: decoded.payload };
}

/** The device cap actually enforced right now for the given state — full plan limit while
 * valid/in grace, trial cap once unlicensed, invalid, or past grace. */
export function effectiveDeviceLimit(state: LicenseState): number {
  if (state.status === "valid" || state.status === "grace") return state.payload.deviceLimit;
  return TRIAL_DEVICE_LIMIT;
}

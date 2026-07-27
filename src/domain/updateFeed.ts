// Pure domain logic for verifying a signed update feed. NO imports from adapters/ or ports/.
//
// A checksum alone doesn't prove authenticity if it's advertised by the same channel that serves
// the download — an attacker who can spoof/MITM the feed response can supply their own binary
// alongside the sha256 of that very binary, and the checksum "passes" against itself. This module
// closes that gap the same way src/domain/license.ts closes it for license files: an Ed25519
// signature over the feed's payload, checked against a public key baked into the app. Signing
// happens offline at release time with a private key that never ships (see
// scripts/sign-release.ts) — deliberately a separate keypair from license signing, so a
// compromise of one trust domain can't forge the other.
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export interface UpdateFeedPayload {
  version: string;
  url: string;
  sha256: string;
  notes?: string;
}

export type UpdateFeedResult = { status: "valid"; payload: UpdateFeedPayload } | { status: "invalid"; reason: string };

/** Canonical JSON the signature is computed over — fixed key order and a lowercased sha256, so
 * the signer and verifier never disagree over incidental formatting. */
function canonicalize(p: { version: string; url: string; sha256: string }): string {
  return JSON.stringify({ version: p.version, url: p.url, sha256: p.sha256.toLowerCase() });
}

/** Feed file/response format: "<base64url(json payload)>.<base64url(ed25519 signature)>" — the
 * same shape @domain/license.ts uses. */
export function encodeUpdateFeed(payload: UpdateFeedPayload, signature: Buffer): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${payloadB64}.${signature.toString("base64url")}`;
}

export function verifyUpdateFeed(raw: string, publicKeyPem: string): UpdateFeedResult {
  const trimmed = raw.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { status: "invalid", reason: "Malformed update feed." };
  const [payloadB64, sigB64] = parts;

  let payload: UpdateFeedPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { status: "invalid", reason: "Update feed payload is not valid JSON." };
  }
  if (typeof payload.version !== "string" || typeof payload.url !== "string" || typeof payload.sha256 !== "string" || !payload.sha256) {
    return { status: "invalid", reason: "Update feed is missing version/url/sha256." };
  }
  if (!payload.url.startsWith("https://")) {
    return { status: "invalid", reason: "Update feed's download URL must be https://." };
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(sigB64, "base64url");
  } catch {
    return { status: "invalid", reason: "Update feed signature is malformed." };
  }

  try {
    const publicKey = createPublicKey(publicKeyPem);
    const data = Buffer.from(canonicalize(payload), "utf-8");
    if (!cryptoVerify(null, data, publicKey, signature)) {
      return { status: "invalid", reason: "Update feed signature does not match — the feed was altered or not signed with the expected release key." };
    }
  } catch {
    return { status: "invalid", reason: "Could not verify update feed signature." };
  }

  return { status: "valid", payload };
}

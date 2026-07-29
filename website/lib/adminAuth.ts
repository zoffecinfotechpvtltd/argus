// Auth for the /admin license-issuing portal. One shared root-admin credential (not a full user
// system — this is an internal vendor tool with one operator role), guarding an endpoint that can
// sign licenses with the private key in LICENSE_PRIVATE_KEY_PEM. Two pieces, same "<data>.<hmac>"
// stateless-token convention @adapters/crypto's HmacAckTokenSigner uses in the main app:
//   - the password itself is never stored in plaintext — ADMIN_PASSWORD_HASH holds
//     "<salt-hex>:<scrypt-hash-hex>", generated once by scripts/hash-admin-password.ts.
//   - a successful login gets a signed, httpOnly session cookie (ADMIN_SESSION_SECRET-keyed
//     HMAC), not a server-side session store — nothing to provision to verify a request.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getClientIp } from "./rateLimit.js";
import { isAllowedIp, parseAllowlist } from "./ipAllowlist.js";

const COOKIE_NAME = "argus_admin_session";
const SESSION_TTL_MS = 15 * 60 * 1000; // 15min — this session can sign licenses, so it auto-expires fast

function sessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET not configured");
  return secret;
}

export function verifyAdminPassword(candidate: string): boolean {
  const stored = process.env.ADMIN_PASSWORD_HASH;
  if (!stored) throw new Error("ADMIN_PASSWORD_HASH not configured");
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) throw new Error("ADMIN_PASSWORD_HASH is malformed — expected \"<salt>:<hash>\"");

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(candidate, Buffer.from(saltHex, "hex"), expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Used once, offline, by scripts/hash-admin-password.ts to produce ADMIN_PASSWORD_HASH. */
export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function signSession(expiresAtMs: number): string {
  return createHmac("sha256", sessionSecret()).update(`admin.${expiresAtMs}`).digest("base64url");
}

export function issueSessionCookie(res: VercelResponse): void {
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const token = `${expiresAtMs}.${signSession(expiresAtMs)}`;
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; ${secure}SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

export function clearSessionCookie(res: VercelResponse): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function hasValidSession(req: VercelRequest): boolean {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return false;
  const [expiresAtStr, sig] = token.split(".");
  if (!expiresAtStr || !sig) return false;
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;

  const expectedSig = signSession(expiresAtMs);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Sends 401 and returns false if there's no valid session — callers should `if (!requireSession(req, res)) return;`. */
export function requireSession(req: VercelRequest, res: VercelResponse): boolean {
  if (hasValidSession(req)) return true;
  res.status(401).json({ error: "UNAUTHORIZED", message: "Not signed in." });
  return false;
}

/**
 * Network-level gate in front of the whole /admin portal, independent of the password: a
 * public URL protected by a password alone still lets anyone on the internet *attempt* logins
 * forever (rate-limited, but forever). This rejects the request before any of that even runs,
 * based on the caller's real IP (see getClientIp — trusts Vercel's own edge header, not a
 * client-suppliable one).
 *
 * Fails CLOSED: ADMIN_ALLOWED_IPS must be set, or every request is rejected — the alternative
 * (falling back to "allow everyone" when unconfigured, like the KV-optional features elsewhere in
 * this portal) would silently defeat the whole point the first time someone forgets to set it.
 * Every /admin API route calls this first, before rate limiting or password checks.
 */
export function requireAllowedIp(req: VercelRequest, res: VercelResponse): boolean {
  const allowlist = parseAllowlist(process.env.ADMIN_ALLOWED_IPS);
  if (allowlist.length === 0) {
    res.status(503).json({
      error: "NOT_CONFIGURED",
      message: "ADMIN_ALLOWED_IPS isn't set on this deployment — the license portal refuses all traffic until it is.",
    });
    return false;
  }
  const ip = getClientIp(req);
  if (!isAllowedIp(ip, allowlist)) {
    // Deliberately generic — doesn't confirm whether the portal even exists at this path to an
    // unrecognized caller, and never echoes back the allowlist or the caller's own IP.
    res.status(403).json({ error: "FORBIDDEN" });
    return false;
  }
  return true;
}

// RFC 6238 TOTP (the standard 6-digit, 30-second, SHA-1 authenticator-app code — same algorithm
// Google Authenticator/Authy/1Password etc. all implement) with no external dependency: base32 and
// HOTP (RFC 4226) are both short enough to implement directly against node:crypto's HMAC.
import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept one step of clock drift either side — codes from ~30s ago or ~30s from now still verify,
 * matching how every real authenticator app already tolerates minor client/server clock skew. */
const WINDOW_STEPS = 1;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit (20-byte) secret, base32-encoded — the standard size every authenticator app expects. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** `otpauth://` URI an authenticator app can import via manual entry or a QR code built from this
 * string elsewhere — no QR image is rendered server-side to avoid pulling in a QR-encoding
 * dependency; the secret/URI is shown as copyable text on the enrollment screen instead. */
export function totpUri(secret: string, accountEmail: string, issuer = "Argus"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now()): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (let drift = -WINDOW_STEPS; drift <= WINDOW_STEPS; drift++) {
    if (hotp(secretBase32, counter + drift) === trimmed) return true;
  }
  return false;
}

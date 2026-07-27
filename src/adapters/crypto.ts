import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TokenSigner } from "@ports/services";

const ALGO = "aes-256-gcm";

/** Encrypts JSON-serializable secrets (SNMP creds, etc.) at rest using the instance key. Format: iv:tag:ciphertext (base64). */
export function encryptSecret(instanceKey: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, instanceKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(instanceKey: Buffer, encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted secret");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, instanceKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Stateless, HMAC-signed password-reset tokens — no DB table needed (same reasoning as
 * HmacAckTokenSigner below). Signing over the user's *current* passwordHash means the token
 * self-invalidates the instant the password actually changes (via this reset or any other path,
 * e.g. an admin resetting it directly on the Users page) — no separate "used" flag to track. */
export function signPasswordResetToken(instanceKey: Buffer, userId: string, currentPasswordHash: string): string {
  const expiresAtMs = Date.now() + PASSWORD_RESET_TTL_MS;
  const sig = createHmac("sha256", instanceKey).update(`reset.${userId}.${currentPasswordHash}.${expiresAtMs}`).digest("base64url");
  return `${expiresAtMs}.${sig}`;
}

export function verifyPasswordResetToken(instanceKey: Buffer, userId: string, currentPasswordHash: string, token: string): boolean {
  const [expiresAtStr, sig] = token.split(".");
  if (!expiresAtStr || !sig) return false;
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;

  const expectedSig = createHmac("sha256", instanceKey).update(`reset.${userId}.${currentPasswordHash}.${expiresAtMs}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Thin `SecretCipher` port wrapper around encryptSecret/decryptSecret above — so application/
 * code (e.g. the discovery-schedule runner) can decrypt a stored SNMP community string via
 * `app.secretCipher.decrypt(...)` without importing this adapter module directly. */
export class InstanceKeySecretCipher {
  constructor(private instanceKey: Buffer) {}

  encrypt(plaintext: string): string {
    return encryptSecret(this.instanceKey, plaintext);
  }

  decrypt(ciphertext: string): string {
    return decryptSecret(this.instanceKey, ciphertext);
  }
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/** HMAC-signed, stateless one-click ack tokens: "<expiresAtMs>.<base64url hmac>". No DB lookup needed to verify. */
export class HmacAckTokenSigner implements TokenSigner {
  constructor(private instanceKey: Buffer) {}

  private sign(alertId: string, expiresAtMs: number): string {
    return createHmac("sha256", this.instanceKey).update(`${alertId}.${expiresAtMs}`).digest("base64url");
  }

  signAckToken(alertId: string, ttlMs: number): string {
    const expiresAtMs = Date.now() + ttlMs;
    const sig = this.sign(alertId, expiresAtMs);
    return `${expiresAtMs}.${sig}`;
  }

  verifyAckToken(alertId: string, token: string): boolean {
    const [expiresAtStr, sig] = token.split(".");
    if (!expiresAtStr || !sig) return false;
    const expiresAtMs = Number(expiresAtStr);
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;

    const expectedSig = this.sign(alertId, expiresAtMs);
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

}

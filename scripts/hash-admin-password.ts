#!/usr/bin/env bun
/**
 * One-time setup helper: hashes a password for the license portal's ADMIN_PASSWORD_HASH env var
 * (website/api/admin/login.ts). The portal never stores or compares the plaintext password — only
 * this hash, generated once here and pasted into Vercel's Project Settings → Environment Variables.
 *
 * Usage:
 *   bun run scripts/hash-admin-password.ts "your new password"
 *
 * Also generate a random ADMIN_SESSION_SECRET while you're there (any long random string works,
 * e.g. `openssl rand -hex 32`) — it signs the login session cookie and isn't derived from this.
 */
import { hashAdminPassword } from "../website/lib/adminAuth";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: bun run scripts/hash-admin-password.ts "a password at least 10 characters long"');
  process.exit(1);
}

console.log("Set this as ADMIN_PASSWORD_HASH in the website Vercel project's env vars:\n");
console.log(hashAdminPassword(password));
console.log("\nDon't commit the plaintext password anywhere — this hash is the only thing that needs to leave your machine.");

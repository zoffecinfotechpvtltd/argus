#!/usr/bin/env bun
/**
 * Signs a release for the auto-update feed. Run this after `bun run release` and after you've
 * uploaded the exe somewhere and know its final public URL — the signature covers that URL, so
 * signing has to happen after the file is actually reachable there, not before.
 *
 * Requires secrets/release-private-key.pem (created once by scripts/generate-release-keypair.ts).
 * That file never leaves your machine — it's gitignored and this script is never compiled into
 * the shipped exe.
 *
 * Usage:
 *   bun run scripts/sign-release.ts --version 1.2.0 \
 *     --url https://github.com/you/argus/releases/download/v1.2.0/Argus-v1.2.0-win-x64.exe \
 *     --exe dist/Argus-v1.2.0-win-x64.exe \
 *     [--notes "Fixed the thing"] [--out dist/update-feed.json]
 *
 * Upload the resulting update-feed.json wherever your app's "Update check URL" setting points.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { join } from "node:path";
import { encodeUpdateFeed, type UpdateFeedPayload } from "../src/domain/updateFeed";

const ROOT = join(import.meta.dir, "..");
const PRIVATE_KEY_PATH = join(ROOT, "secrets", "release-private-key.pem");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const version = arg("version");
const url = arg("url");
const exePath = arg("exe");
const notes = arg("notes");
const outPath = arg("out") ?? join(ROOT, "dist", "update-feed.json");

if (!version || !url || !exePath) {
  console.error("Usage: bun run scripts/sign-release.ts --version <x.y.z> --url <https://...> --exe <path-to-exe> [--notes <text>] [--out <path>]");
  process.exit(1);
}
if (!url.startsWith("https://")) {
  console.error("--url must be https:// — the app refuses to trust a feed advertising a plain-http download.");
  process.exit(1);
}
if (!existsSync(PRIVATE_KEY_PATH)) {
  console.error(`No private key at ${PRIVATE_KEY_PATH}. Run \`bun run scripts/generate-release-keypair.ts\` once first.`);
  process.exit(1);
}
if (!existsSync(exePath)) {
  console.error(`No such file: ${exePath}`);
  process.exit(1);
}

const sha256 = createHash("sha256").update(readFileSync(exePath)).digest("hex");
const payload: UpdateFeedPayload = { version, url, sha256, ...(notes ? { notes } : {}) };

const privateKey = createPrivateKey(readFileSync(PRIVATE_KEY_PATH, "utf-8"));
const canonical = JSON.stringify({ version: payload.version, url: payload.url, sha256: payload.sha256.toLowerCase() });
const signature = cryptoSign(null, Buffer.from(canonical, "utf-8"), privateKey);

writeFileSync(outPath, encodeUpdateFeed(payload, signature));

console.log("Signed update feed written:");
console.log(`  Version  ${version}`);
console.log(`  URL      ${url}`);
console.log(`  SHA-256  ${sha256}`);
console.log(`  File     ${outPath}`);
console.log("\nUpload this file's contents wherever your customers' 'Update check URL' setting points.");

#!/usr/bin/env bun
/**
 * Issues one signed license file. Run this after a customer's manual payment clears (bank
 * transfer, UPI, PayPal invoice — whatever you collect it through), then email the customer both
 * Argus.exe and the .license.key file this prints.
 *
 * Prefer a UI instead? `bun run scripts/license-admin.ts` opens a local form (customer, plan,
 * devices, expiry) that issues the exact same license file — this CLI and that UI share the
 * signing code in scripts/lib/issueLicense.ts.
 *
 * Requires secrets/license-private-key.pem (created once by scripts/generate-license-keypair.ts).
 * That file never leaves your machine — it's gitignored and this script is never compiled into
 * the shipped exe.
 *
 * Usage:
 *   bun run scripts/generate-license.ts --customer "Acme Corp" --plan business --devices 150 --expires 2027-07-11
 *   bun run scripts/generate-license.ts --customer "Acme Corp" --plan unlimited --devices 100000 --perpetual
 *
 * Flags:
 *   --customer   <name>      required
 *   --plan       starter|professional|business|enterprise|unlimited   required
 *   --devices    <n>         required — device cap this license grants
 *   --expires    <YYYY-MM-DD>  the license's expiry date (renewal date, for a subscription sale)
 *   --perpetual              shorthand for --expires 50 years from now (one-time-purchase sale)
 *   --out        <path>      output file (default: "<slugified customer>.license.key")
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isLicensePlan, issueLicense, perpetualExpiry, slugify, validateDevicesForPlan } from "./lib/issueLicense";

const ROOT = join(import.meta.dir, "..");
const PRIVATE_KEY_PATH = join(ROOT, "secrets", "license-private-key.pem");

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function fail(message: string): never {
  console.error(`Error: ${message}\n`);
  console.error('Usage: bun run scripts/generate-license.ts --customer "Acme Corp" --plan business --devices 150 --expires 2027-07-11');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(PRIVATE_KEY_PATH)) {
  fail(`No private key at ${PRIVATE_KEY_PATH}. Run: bun run scripts/generate-license-keypair.ts`);
}

const customer = typeof args.customer === "string" ? args.customer : fail("--customer is required");
const plan = args.plan;
if (typeof plan !== "string" || !isLicensePlan(plan)) fail('--plan must be one of: starter, professional, business, enterprise, unlimited');

const devicesRaw = typeof args.devices === "string" ? Number(args.devices) : NaN;
if (!Number.isFinite(devicesRaw) || devicesRaw <= 0) fail("--devices must be a positive number");

const rangeWarning = validateDevicesForPlan(plan, devicesRaw);
if (rangeWarning) fail(rangeWarning);

let expiresAt: string;
if (args.perpetual === true) {
  expiresAt = perpetualExpiry();
} else if (typeof args.expires === "string") {
  const d = new Date(args.expires);
  if (Number.isNaN(d.getTime())) fail(`--expires "${args.expires}" is not a valid date`);
  expiresAt = d.toISOString();
} else {
  fail("Provide either --expires YYYY-MM-DD or --perpetual");
}

const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, "utf-8");
const { payload, licenseFile } = issueLicense({ customer, plan, devices: devicesRaw, expiresAt, privateKeyPem });

const outPath = typeof args.out === "string" ? args.out : join(ROOT, `${slugify(customer)}.license.key`);
writeFileSync(outPath, licenseFile);

console.log("License issued:");
console.log(`  Customer     ${payload.customer}`);
console.log(`  Plan         ${payload.plan}`);
console.log(`  Device limit ${payload.deviceLimit}`);
console.log(`  Expires      ${payload.expiresAt}`);
console.log(`  File         ${outPath}`);
console.log("\nEmail this file to the customer along with Argus.exe. They apply it in Settings → License.");

#!/usr/bin/env bun
/**
 * A local, vendor-only web UI for issuing Argus license files — the same signing logic as
 * scripts/generate-license.ts (see scripts/lib/issueLicense.ts), just with a form instead of flags.
 *
 * This is NOT part of the product you ship to customers: it's never imported by
 * src/bootstrap/main.ts, never compiled into Argus.exe, and only binds to localhost. Run it on
 * your own machine whenever you need to issue a license after a sale:
 *
 *   bun run scripts/license-admin.ts
 *
 * It opens http://localhost:4790 in your default browser. Every license issued is written to
 * issued-licenses/ (gitignored) and listed on the page so you can find past ones again.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { spawn } from "node:child_process";
import { LICENSE_PLANS, PLAN_DEVICE_RANGES, type LicensePlan } from "../src/domain/license";
import { isLicensePlan, issueLicense, perpetualExpiry, slugify, validateDevicesForPlan } from "./lib/issueLicense";

const ROOT = join(import.meta.dir, "..");
const PRIVATE_KEY_PATH = join(ROOT, "secrets", "license-private-key.pem");
const OUT_DIR = join(ROOT, "issued-licenses");
const PORT = Number(process.env.PORT ?? 4790);

if (!existsSync(PRIVATE_KEY_PATH)) {
  console.error(`No private key at ${PRIVATE_KEY_PATH}. Run: bun run scripts/generate-license-keypair.ts`);
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function planOptions(selected?: LicensePlan): string {
  return LICENSE_PLANS.map((p) => {
    const r = PLAN_DEVICE_RANGES[p];
    const rangeLabel = r.max === null ? `${r.min}+ devices` : `${r.min}-${r.max} devices`;
    return `<option value="${p}" ${p === selected ? "selected" : ""}>${r.label} (${rangeLabel})</option>`;
  }).join("\n");
}

function listIssued(): { file: string; customer: string; plan: string; deviceLimit: number; expiresAt: string }[] {
  return readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".license.key"))
    .map((file) => {
      try {
        const raw = readFileSync(join(OUT_DIR, file), "utf-8");
        const payloadB64 = raw.trim().split(".")[0]!;
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
        return { file, customer: payload.customer, plan: payload.plan, deviceLimit: payload.deviceLimit, expiresAt: payload.expiresAt };
      } catch {
        return { file, customer: "(unreadable)", plan: "-", deviceLimit: 0, expiresAt: "" };
      }
    })
    .reverse();
}

function pageShell(body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Argus — License Issuer</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background: #0f1115; color: #e6e6e6; max-width: 720px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 20px; } h2 { font-size: 15px; color: #9ba1ab; margin-top: 32px; }
  label { display: block; font-size: 13px; color: #9ba1ab; margin: 14px 0 4px; }
  input, select { width: 100%; box-sizing: border-box; padding: 8px 10px; background: #1a1d24; border: 1px solid #2a2e38; border-radius: 6px; color: #e6e6e6; font-size: 14px; }
  button { margin-top: 18px; padding: 9px 18px; background: #34d399; border: none; border-radius: 6px; color: #06110c; font-weight: 600; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #2a2e38; }
  textarea { width: 100%; height: 90px; font-family: monospace; font-size: 12px; background: #1a1d24; color: #e6e6e6; border: 1px solid #2a2e38; border-radius: 6px; padding: 8px; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .checkbox-row input { width: auto; }
  .error { color: #f87171; margin-top: 12px; }
  a { color: #34d399; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function formPage(opts: { error?: string } = {}): string {
  const rows = listIssued();
  return pageShell(`
    <h1>Argus — Issue a license</h1>
    <p style="color:#9ba1ab;font-size:13px">Runs locally only (localhost:${PORT}). Never expose this to the internet — it can sign licenses.</p>
    <form method="post" action="/issue">
      <label>Customer name</label>
      <input name="customer" required placeholder="Acme Corp">
      <label>Plan</label>
      <select name="plan">${planOptions()}</select>
      <label>Device limit</label>
      <input name="devices" type="number" min="1" required placeholder="e.g. 150">
      <div class="checkbox-row">
        <input type="checkbox" name="perpetual" id="perpetual" onclick="document.getElementById('expiresRow').style.display=this.checked?'none':'block'">
        <label for="perpetual" style="margin:0">Perpetual (one-time purchase, no renewal)</label>
      </div>
      <div id="expiresRow">
        <label>Expires on</label>
        <input name="expires" type="date">
      </div>
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
      <button type="submit">Issue license</button>
    </form>
    <h2>Previously issued (${rows.length})</h2>
    <table>
      <tr><th>Customer</th><th>Plan</th><th>Devices</th><th>Expires</th><th></th></tr>
      ${rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.customer)}</td><td>${escapeHtml(r.plan)}</td><td>${r.deviceLimit}</td><td>${new Date(r.expiresAt).toLocaleDateString()}</td><td><a href="/download/${encodeURIComponent(r.file)}">download</a></td></tr>`
        )
        .join("")}
    </table>
  `);
}

function resultPage(customer: string, licenseFile: string, outPath: string): string {
  return pageShell(`
    <h1>License issued for ${escapeHtml(customer)}</h1>
    <p>Saved to <code>${escapeHtml(outPath)}</code>. Email this file (or paste its contents) to the customer along with Argus.exe — they apply it in Settings → License.</p>
    <textarea readonly>${escapeHtml(licenseFile)}</textarea>
    <p><a href="/download/${encodeURIComponent(basename(outPath))}">Download the .license.key file</a></p>
    <p><a href="/">&larr; Issue another</a></p>
  `);
}

const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, "utf-8");

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" && req.method === "GET") {
      return new Response(formPage(), { headers: { "content-type": "text/html" } });
    }

    if (url.pathname === "/download/" || url.pathname.startsWith("/download/")) {
      const name = basename(decodeURIComponent(url.pathname.slice("/download/".length)));
      const path = join(OUT_DIR, name);
      if (!name.endsWith(".license.key") || !existsSync(path)) return new Response("Not found", { status: 404 });
      return new Response(readFileSync(path), { headers: { "content-type": "text/plain", "content-disposition": `attachment; filename="${name}"` } });
    }

    if (url.pathname === "/issue" && req.method === "POST") {
      const form = await req.formData();
      const customer = String(form.get("customer") ?? "").trim();
      const planRaw = String(form.get("plan") ?? "");
      const devices = Number(form.get("devices"));
      const perpetual = form.get("perpetual") === "on";
      const expiresRaw = String(form.get("expires") ?? "");

      if (!customer) return new Response(formPage({ error: "Customer name is required." }), { headers: { "content-type": "text/html" } });
      if (!isLicensePlan(planRaw)) return new Response(formPage({ error: "Invalid plan." }), { headers: { "content-type": "text/html" } });
      if (!Number.isFinite(devices) || devices <= 0)
        return new Response(formPage({ error: "Device limit must be a positive number." }), { headers: { "content-type": "text/html" } });

      const rangeWarning = validateDevicesForPlan(planRaw, devices);
      if (rangeWarning) return new Response(formPage({ error: rangeWarning }), { headers: { "content-type": "text/html" } });

      let expiresAt: string;
      if (perpetual) {
        expiresAt = perpetualExpiry();
      } else {
        const d = new Date(expiresRaw);
        if (!expiresRaw || Number.isNaN(d.getTime()))
          return new Response(formPage({ error: "Provide a valid expiry date, or check Perpetual." }), { headers: { "content-type": "text/html" } });
        expiresAt = d.toISOString();
      }

      const { licenseFile } = issueLicense({ customer, plan: planRaw, devices, expiresAt, privateKeyPem });
      const outPath = join(OUT_DIR, `${slugify(customer)}-${Date.now()}.license.key`);
      writeFileSync(outPath, licenseFile);

      return new Response(resultPage(customer, licenseFile, outPath), { headers: { "content-type": "text/html" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

const homeUrl = `http://localhost:${server.port}`;
console.log(`License issuer running at ${homeUrl} (localhost only)`);
if (process.platform === "win32") spawn("cmd", ["/c", "start", "", homeUrl], { detached: true, stdio: "ignore" }).unref();

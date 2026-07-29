// The hosted counterpart to scripts/license-admin.ts (which still exists for issuing offline from
// your own machine — this is the same signing logic, just reachable over the internet behind a
// root-admin login so you can issue + email a license from anywhere, not only your dev box).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireSession } from "../../lib/adminAuth.js";
import { escapeHtml, sendMail } from "../../lib/mail.js";
import { isKvConfigured, lpushCapped, lrange, lrem } from "../../lib/kv.js";
import { rateLimit } from "../../lib/rateLimit.js";
import {
  type LicensePlan,
  PLAN_DEVICE_RANGES,
  isLicensePlan,
  issueLicense,
  perpetualExpiry,
  validateDevicesForPlan,
} from "../../lib/license.js";

const HISTORY_KEY = "argus:issued-licenses";
const HISTORY_MAX = 200;

interface IssuedRecord {
  licenseId: string;
  customer: string;
  contactEmail: string;
  plan: LicensePlan;
  deviceLimit: number;
  issuedAt: string;
  expiresAt: string;
  emailed: boolean;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function licenseEmailHtml(opts: { customer: string; plan: LicensePlan; deviceLimit: number; expiresAt: string; licenseFile: string }): string {
  const planLabel = PLAN_DEVICE_RANGES[opts.plan].label;
  const expiryText = new Date(opts.expiresAt).getFullYear() > new Date().getFullYear() + 40
    ? "Perpetual (no renewal needed)"
    : new Date(opts.expiresAt).toLocaleDateString();
  return `
    <p>Hi ${escapeHtml(opts.customer)},</p>
    <p>Your Argus license is attached (<code>${escapeHtml(opts.customer)}.license.key</code>) and also included below.</p>
    <ul>
      <li><strong>Plan:</strong> ${escapeHtml(planLabel)}</li>
      <li><strong>Devices:</strong> ${opts.deviceLimit}</li>
      <li><strong>Expires:</strong> ${expiryText}</li>
    </ul>
    <p>To apply it: open Argus, sign in as an admin, go to <strong>Settings → License</strong>, paste the
    contents below into "Apply a license", and click Apply.</p>
    <pre style="background:#111;color:#eee;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all;">${escapeHtml(opts.licenseFile)}</pre>
    <p>Questions? Just reply to this email.</p>
  `;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireSession(req, res)) return;

  // Behind a login, but still rate-limited: a stolen/leaked session cookie shouldn't be able to
  // spam-issue licenses or hammer the outbound mail send.
  const allowed = await rateLimit(req, res, { keyPrefix: "admin-licenses", max: 30, windowSeconds: 60 });
  if (!allowed) return;

  if (req.method === "GET") {
    if (!isKvConfigured()) return res.status(200).json({ configured: false, records: [] });
    try {
      const raw = await lrange(HISTORY_KEY, 0, HISTORY_MAX - 1);
      const records = raw.map((r) => JSON.parse(r) as IssuedRecord);
      return res.status(200).json({ configured: true, records });
    } catch (err) {
      console.error("failed to load license history", err);
      return res.status(500).json({ error: "HISTORY_UNAVAILABLE", message: "Could not load issuance history." });
    }
  }

  if (req.method === "DELETE") {
    // Removes an entry from this portal's issuance history log only — it is NOT an online
    // revocation check. Argus licenses are self-contained signed files verified offline
    // (src/domain/license.ts): the on-prem product never calls home, so nothing server-side can
    // stop an already-issued license file from continuing to work wherever it was applied. This
    // is bookkeeping ("we don't consider this customer active anymore, stop showing it here"),
    // not a kill switch — see GUIDE.md for the tradeoffs of the offline-licensing design.
    if (!isKvConfigured()) return res.status(400).json({ error: "NOT_CONFIGURED", message: "No KV store configured — nothing to delete." });
    const licenseId = (req.query.licenseId as string | undefined) || (req.body as { licenseId?: string } | undefined)?.licenseId;
    if (!licenseId) return res.status(400).json({ error: "MISSING_LICENSE_ID", message: "licenseId is required." });

    try {
      const raw = await lrange(HISTORY_KEY, 0, HISTORY_MAX - 1);
      const matches = raw.filter((entry) => {
        try {
          return (JSON.parse(entry) as IssuedRecord).licenseId === licenseId;
        } catch {
          return false;
        }
      });
      if (matches.length === 0) return res.status(404).json({ error: "NOT_FOUND", message: "No history entry with that license ID." });
      for (const entry of matches) await lrem(HISTORY_KEY, entry);
      return res.status(200).json({ ok: true, removed: matches.length });
    } catch (err) {
      console.error("failed to delete license history entry", err);
      return res.status(500).json({ error: "DELETE_FAILED", message: "Could not delete history entry." });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const privateKeyPem = process.env.LICENSE_PRIVATE_KEY_PEM;
  if (!privateKeyPem) {
    return res.status(500).json({ error: "NOT_CONFIGURED", message: "LICENSE_PRIVATE_KEY_PEM isn't set on this deployment." });
  }

  const body = req.body as {
    customer?: string;
    contactEmail?: string;
    plan?: string;
    devices?: number;
    perpetual?: boolean;
    expires?: string;
    sendEmail?: boolean;
  };

  const customer = (body.customer || "").trim();
  const contactEmail = (body.contactEmail || "").trim();
  const planRaw = body.plan || "";
  const devices = Number(body.devices);
  const sendEmail = body.sendEmail !== false;

  if (!customer) return res.status(400).json({ error: "MISSING_CUSTOMER", message: "Customer name is required." });
  if (sendEmail && (!contactEmail || !isValidEmail(contactEmail))) {
    return res.status(400).json({ error: "INVALID_EMAIL", message: "A valid contact email is required to send the license, or uncheck \"email this license\"." });
  }
  if (!isLicensePlan(planRaw)) return res.status(400).json({ error: "INVALID_PLAN", message: "Invalid plan." });
  if (!Number.isFinite(devices) || devices <= 0) {
    return res.status(400).json({ error: "INVALID_DEVICES", message: "Device limit must be a positive number." });
  }
  const rangeWarning = validateDevicesForPlan(planRaw, devices);
  if (rangeWarning) return res.status(400).json({ error: "PLAN_DEVICE_MISMATCH", message: rangeWarning });

  let expiresAt: string;
  if (body.perpetual) {
    expiresAt = perpetualExpiry();
  } else {
    const d = new Date(body.expires || "");
    if (!body.expires || Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: "INVALID_EXPIRY", message: "Provide a valid expiry date, or set perpetual." });
    }
    expiresAt = d.toISOString();
  }

  const { payload, licenseFile } = issueLicense({ customer, plan: planRaw, devices, expiresAt, privateKeyPem });

  let emailed = false;
  let emailError: string | undefined;
  if (sendEmail) {
    try {
      await sendMail({
        to: contactEmail,
        subject: `Your Argus license — ${customer}`,
        html: licenseEmailHtml({ customer, plan: payload.plan, deviceLimit: payload.deviceLimit, expiresAt: payload.expiresAt, licenseFile }),
        attachments: [{ name: `${customer}.license.key`, contentBase64: Buffer.from(licenseFile, "utf-8").toString("base64"), contentType: "text/plain" }],
      });
      emailed = true;
    } catch (err) {
      console.error("license email failed", err);
      emailError = err instanceof Error ? err.message : "Email failed to send.";
    }
  }

  if (isKvConfigured()) {
    try {
      const record: IssuedRecord = {
        licenseId: payload.licenseId,
        customer,
        contactEmail,
        plan: payload.plan,
        deviceLimit: payload.deviceLimit,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        emailed,
      };
      await lpushCapped(HISTORY_KEY, JSON.stringify(record), HISTORY_MAX);
    } catch (err) {
      console.error("failed to record license history (license was still issued)", err);
    }
  }

  return res.status(200).json({ ok: true, payload, licenseFile, emailed, emailError });
}

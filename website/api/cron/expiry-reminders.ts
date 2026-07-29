// Runs daily (see vercel.json's `crons` entry) and emails any customer whose license expires
// within the next 7 days — the on-prem product itself can never do this (licenses are verified
// entirely offline, see src/domain/license.ts's header comment), so this is the only place in the
// system that both knows expiry dates *and* has a customer email address on file: the admin
// portal's issuance-history KV log (see api/admin/licenses.ts).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { escapeHtml, sendMail } from "../../lib/mail.js";
import { isKvConfigured, lrange, lset } from "../../lib/kv.js";
import { LICENSE_HISTORY_KEY, LICENSE_HISTORY_MAX, PLAN_DEVICE_RANGES, type IssuedRecord } from "../../lib/license.js";

const REMINDER_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PERPETUAL_CUTOFF_YEARS = 40; // matches the +50y convention issueLicense() uses for "perpetual"

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPerpetual(expiresAt: string): boolean {
  return new Date(expiresAt).getFullYear() > new Date().getFullYear() + PERPETUAL_CUTOFF_YEARS;
}

function reminderEmailHtml(r: IssuedRecord, daysLeft: number): string {
  const planLabel = PLAN_DEVICE_RANGES[r.plan]?.label ?? r.plan;
  const expiryDate = new Date(r.expiresAt).toLocaleDateString();
  return `
    <p>Hi ${escapeHtml(r.customer)},</p>
    <p>Your Argus license (<strong>${escapeHtml(planLabel)}</strong>, ${r.deviceLimit} devices) ${
    daysLeft <= 0 ? "expires today" : `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
  } — on <strong>${expiryDate}</strong>.</p>
    <p>Monitoring keeps running at full capacity for a 14-day grace period after expiry, then drops to a
    5-device trial cap until renewed. To avoid any interruption, reply to this email or reach out to renew now.</p>
    <p>Once you have a new license file, apply it from Argus under <strong>Settings → License</strong>.</p>
  `;
}

/** Vercel Cron requests carry `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on the
 * project (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) — this is the
 * only thing standing between this endpoint (which sends real email) and the public internet, so
 * refuse to run at all if the secret isn't configured rather than silently allowing unauthenticated
 * triggers. */
function isAuthorizedCronRequest(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Missing/invalid cron secret." });
  }
  if (!isKvConfigured()) return res.status(200).json({ ok: true, note: "KV not configured — no history to scan.", sent: 0 });

  // Index-based LSET (below) assumes the list's positions don't shift between this lrange and the
  // matching lset — true in practice (this only races against someone issuing a license in the
  // same instant the daily cron fires), and the failure mode if it ever did race is just one
  // record's reminder flag landing on the wrong entry, not a crash or a duplicate charge. A
  // licenseId-keyed hash would be race-free but is a bigger change to the existing list-based
  // history mechanism than this fix warrants.
  const raw = await lrange(LICENSE_HISTORY_KEY, 0, LICENSE_HISTORY_MAX - 1);
  const now = Date.now();

  let sent = 0;
  let skipped = 0;
  const errors: { licenseId: string; message: string }[] = [];

  for (let index = 0; index < raw.length; index++) {
    let record: IssuedRecord;
    try {
      record = JSON.parse(raw[index]!) as IssuedRecord;
    } catch {
      continue;
    }

    if (record.expiryReminderSentAt) {
      skipped++;
      continue;
    }
    if (isPerpetual(record.expiresAt)) {
      skipped++;
      continue;
    }
    if (!record.contactEmail || !isValidEmail(record.contactEmail)) {
      skipped++;
      continue;
    }
    const daysLeft = Math.ceil((new Date(record.expiresAt).getTime() - now) / MS_PER_DAY);
    if (daysLeft > REMINDER_WINDOW_DAYS || daysLeft < 0) {
      skipped++;
      continue;
    }

    try {
      await sendMail({
        to: record.contactEmail,
        subject: `Your Argus license expires ${daysLeft <= 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`} — ${record.customer}`,
        html: reminderEmailHtml(record, daysLeft),
      });
      const updated: IssuedRecord = { ...record, expiryReminderSentAt: new Date(now).toISOString() };
      await lset(LICENSE_HISTORY_KEY, index, JSON.stringify(updated));
      sent++;
    } catch (err) {
      errors.push({ licenseId: record.licenseId, message: err instanceof Error ? err.message : "send failed" });
    }
  }

  return res.status(200).json({ ok: true, scanned: raw.length, sent, skipped, errors });
}

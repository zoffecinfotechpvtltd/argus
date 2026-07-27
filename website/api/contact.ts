// Vercel serverless function — receives the contact form POST and relays it as an email via
// Microsoft Graph (app-only client-credentials flow), so no mailbox password ever touches this
// codebase. Requires Azure AD app registration + admin-consented Mail.Send permission; see
// ../GUIDE.md §9.6 for the one-time setup. All secrets are env vars, never committed.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { escapeHtml, sendMail } from "../lib/mail.js";
import { rateLimit } from "../lib/rateLimit.js";

const SALES_INBOX = process.env.CONTACT_TO_EMAIL || "sales@example.com";
const MAX_ATTEMPTS_PER_WINDOW = 5;
const WINDOW_SECONDS = 15 * 60;

interface ContactBody {
  name?: string;
  email?: string;
  company?: string;
  devices?: string;
  plan?: string;
  message?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const allowed = await rateLimit(req, res, { keyPrefix: "contact-form", max: MAX_ATTEMPTS_PER_WINDOW, windowSeconds: WINDOW_SECONDS });
  if (!allowed) return;

  const body = req.body as ContactBody;
  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const company = (body.company || "").trim();
  const devices = (body.devices || "").trim();
  const plan = (body.plan || "").trim();
  const message = (body.message || "").trim();

  if (!name || !email || !isValidEmail(email)) {
    return res.status(400).json({ error: "Please provide your name and a valid email address." });
  }
  if (name.length > 200 || email.length > 200 || company.length > 200 || message.length > 5000) {
    return res.status(400).json({ error: "One of the fields is too long." });
  }

  if (!process.env.MAIL_SENDER_UPN) {
    console.error("MAIL_SENDER_UPN not configured");
    return res.status(500).json({ error: `Contact form is not configured yet. Please email ${SALES_INBOX} directly.` });
  }

  try {
    const htmlBody = `
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Company:</strong> ${escapeHtml(company) || "—"}</p>
      <p><strong>Approx. devices:</strong> ${escapeHtml(devices) || "—"}</p>
      <p><strong>Plan interested in:</strong> ${escapeHtml(plan) || "—"}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, "<br/>") || "—"}</p>
    `;

    await sendMail({
      to: SALES_INBOX,
      subject: `Argus sales inquiry — ${company || name}`,
      html: htmlBody,
      replyTo: { address: email, name },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("contact form error", err);
    return res.status(500).json({ error: `Could not send your message right now. Please email ${SALES_INBOX} directly.` });
  }
}

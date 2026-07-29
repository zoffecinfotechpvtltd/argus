import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hasValidSession, requireAllowedIp } from "../../lib/adminAuth.js";
import { rateLimit } from "../../lib/rateLimit.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!requireAllowedIp(req, res)) return;
    const allowed = await rateLimit(req, res, { keyPrefix: "admin-session-check", max: 60, windowSeconds: 60 });
    if (!allowed) return;
    return res.status(200).json({ authenticated: hasValidSession(req) });
  } catch (err) {
    // Surfaced as real JSON instead of a raw 500 so the frontend can show the actual cause
    // (e.g. "ADMIN_SESSION_SECRET not configured") instead of a generic network-error message.
    console.error("admin session check crashed", err);
    return res.status(500).json({ error: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) });
  }
}

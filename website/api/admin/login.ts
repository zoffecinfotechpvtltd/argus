import type { VercelRequest, VercelResponse } from "@vercel/node";
import { issueSessionCookie, verifyAdminPassword } from "../../lib/adminAuth.js";
import { rateLimit } from "../../lib/rateLimit.js";

const MAX_ATTEMPTS_PER_WINDOW = 10;
const WINDOW_SECONDS = 15 * 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Best-effort brute-force throttle, keyed by IP.
    const allowed = await rateLimit(req, res, { keyPrefix: "admin-login-attempts", max: MAX_ATTEMPTS_PER_WINDOW, windowSeconds: WINDOW_SECONDS });
    if (!allowed) return;

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) return res.status(400).json({ error: "MISSING_PASSWORD", message: "Password is required." });

    let ok: boolean;
    try {
      ok = verifyAdminPassword(password);
    } catch (err) {
      console.error("admin login not configured", err);
      return res.status(500).json({ error: "NOT_CONFIGURED", message: "Admin login isn't configured yet (ADMIN_PASSWORD_HASH is missing or malformed)." });
    }

    if (!ok) return res.status(401).json({ error: "INVALID_PASSWORD", message: "Incorrect password." });

    // Separately guarded: password can be correct while ADMIN_SESSION_SECRET is still missing —
    // that's a distinct config error, not "wrong password", and deserves its own message.
    try {
      issueSessionCookie(res);
    } catch (err) {
      console.error("could not issue session cookie", err);
      return res.status(500).json({ error: "SESSION_NOT_CONFIGURED", message: "Password is correct, but ADMIN_SESSION_SECRET isn't configured on this deployment." });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("admin login crashed", err);
    return res.status(500).json({ error: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) });
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSessionCookie } from "../../lib/adminAuth.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}

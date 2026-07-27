import type { VercelRequest, VercelResponse } from "@vercel/node";
import { incrWithExpiry, isKvConfigured } from "./kv.js";

/**
 * Real client IP for a Vercel serverless function. `x-vercel-forwarded-for` is set by Vercel's own
 * edge network and cannot be forged by the client (Vercel overwrites/strips a client-supplied copy
 * of this specific header before the function sees it), so it's preferred when present. Plain
 * `x-forwarded-for` CAN be client-supplied — a request straight from a browser lets the caller set
 * any value for the *first* entry in that chain, so if we ever fall back to it, the trustworthy
 * value is the LAST entry (the hop nearest to us, i.e. Vercel's own record of the connection), not
 * the first. Never trust index [0] of a client-reachable x-forwarded-for header.
 */
export function getClientIp(req: VercelRequest): string {
  const vercelIp = req.headers["x-vercel-forwarded-for"];
  if (typeof vercelIp === "string" && vercelIp.trim()) return vercelIp.split(",")[0]!.trim();

  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }

  return req.socket?.remoteAddress || "unknown";
}

/**
 * Best-effort fixed-window rate limit keyed by client IP. Fails open (logs and allows the request)
 * when KV isn't configured, same "degrade, don't silently block or silently allow-unlimited"
 * convention as the rest of the /admin portal — see website/lib/kv.ts's isKvConfigured doc comment.
 * Returns true if the request should proceed; on false, a 429 has already been written to `res`.
 */
export async function rateLimit(
  req: VercelRequest,
  res: VercelResponse,
  opts: { keyPrefix: string; max: number; windowSeconds: number }
): Promise<boolean> {
  if (!isKvConfigured()) {
    console.warn(`KV not configured — ${opts.keyPrefix} has no rate limiting`);
    return true;
  }

  const ip = getClientIp(req);
  try {
    const attempts = await incrWithExpiry(`${opts.keyPrefix}:${ip}`, opts.windowSeconds);
    if (attempts > opts.max) {
      res.status(429).json({ error: "TOO_MANY_REQUESTS", message: "Too many requests. Try again later." });
      return false;
    }
    return true;
  } catch (err) {
    console.error(`rate limit check failed for ${opts.keyPrefix} (continuing without it)`, err);
    return true;
  }
}

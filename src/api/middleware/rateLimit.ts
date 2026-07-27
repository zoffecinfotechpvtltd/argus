import type { Context, Next } from "hono";
import { getClientIp } from "@api/middleware/auth";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/** In-memory fixed-window rate limiter, keyed by client IP (or a custom key) + route key. Fine for
 * single-process exe mode. Defaults to the real TCP peer address (see getClientIp) rather than a
 * client-suppliable header — a caller-supplied X-Forwarded-For would let anyone reset their own
 * bucket on every request just by changing the header, defeating the limiter entirely. */
export function rateLimit(opts: { max: number; windowMs: number; keyPrefix: string; keyFn?: (c: Context) => string }) {
  const buckets = new Map<string, Bucket>();

  return async (c: Context, next: Next) => {
    const identity = opts.keyFn ? opts.keyFn(c) : getClientIp(c);
    const key = `${opts.keyPrefix}:${identity}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.lastRefill > opts.windowMs) {
      bucket = { tokens: opts.max, lastRefill: now };
      buckets.set(key, bucket);
    }
    if (bucket.tokens <= 0) {
      const retryAfterSec = Math.ceil((opts.windowMs - (now - bucket.lastRefill)) / 1000);
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "RATE_LIMITED" }, 429);
    }
    bucket.tokens -= 1;
    await next();
  };
}

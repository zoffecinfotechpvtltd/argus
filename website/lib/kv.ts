// Minimal REST client for Vercel KV / Upstash Redis — no @vercel/kv or @upstash/redis dependency,
// just fetch against the REST API both expose (Vercel KV *is* Upstash Redis under the hood, same
// REST protocol: https://upstash.com/docs/redis/features/restapi). Optional: every caller here
// degrades gracefully (see isKvConfigured) so the admin portal still works — minus issuance
// history and login rate-limiting — before a KV store is provisioned.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export function isKvConfigured(): boolean {
  return !!KV_URL && !!KV_TOKEN;
}

async function command(...args: (string | number)[]): Promise<unknown> {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured (KV_REST_API_URL / KV_REST_API_TOKEN unset)");
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`KV command failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { result: unknown };
  return body.result;
}

/** Adds `member` to the front of a capped list — used for the issued-licenses feed (newest first). */
export async function lpushCapped(key: string, member: string, maxLen: number): Promise<void> {
  await command("LPUSH", key, member);
  await command("LTRIM", key, 0, maxLen - 1);
}

export async function lrange(key: string, start: number, stop: number): Promise<string[]> {
  const result = await command("LRANGE", key, start, stop);
  return Array.isArray(result) ? (result as string[]) : [];
}

/** Removes every element exactly equal to `member` from the list — the value must be the exact
 * raw string previously read back from lrange (Redis LREM does string equality, not JSON
 * equality), which is why callers re-fetch the list and pass the raw entry back rather than
 * re-serializing a parsed object. Returns the number of elements removed. */
export async function lrem(key: string, member: string): Promise<number> {
  const result = await command("LREM", key, 0, member);
  return typeof result === "number" ? result : 0;
}

/** Overwrites the element at `index` in place (0 = the list's head, i.e. the most recently
 * lpushCapped'd item) — used to flip a flag on an existing record (e.g. "reminder sent") without
 * disturbing its position in the list the way a remove-then-push would. */
export async function lset(key: string, index: number, value: string): Promise<void> {
  await command("LSET", key, index, value);
}

/** Fixed-window rate limit: returns the request count for `key` within the current window,
 * incrementing it and setting the window's expiry on first use. */
export async function incrWithExpiry(key: string, windowSeconds: number): Promise<number> {
  const count = await command("INCR", key);
  if (typeof count === "number" && count === 1) {
    await command("EXPIRE", key, windowSeconds);
  }
  return typeof count === "number" ? count : 0;
}

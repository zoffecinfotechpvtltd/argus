import Redis from "ioredis";

let client: Redis | null = null;

/** One shared ioredis connection per process (poller or web), reused across the lease coordinator
 * (M1) and the pub/sub event bus (M2) — same reasoning as getPgPool: one pool per process, not one
 * per caller. */
export function getRedis(url: string): Redis {
  if (client) return client;
  client = new Redis(url, { maxRetriesPerRequest: 3 });
  return client;
}

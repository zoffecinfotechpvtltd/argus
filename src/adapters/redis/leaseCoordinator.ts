import type Redis from "ioredis";
import type { LeaseCoordinator } from "@ports/services";

// Renew/release must check ownership atomically (GET-compare-then-write) so a poller that stalled
// past its TTL and lost the lease to another owner can never clobber that owner's lease with a
// blind PEXPIRE/DEL — Lua runs atomically inside Redis, a plain GET-then-write in application code
// would race against the very renewal it's trying to protect.
const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`;

export class RedisLeaseCoordinator implements LeaseCoordinator {
  constructor(
    private redis: Redis,
    private keyPrefix = "argus:lease:"
  ) {}

  private key(resourceId: string): string {
    return `${this.keyPrefix}${resourceId}`;
  }

  async acquire(resourceId: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(this.key(resourceId), ownerId, "PX", ttlMs, "NX");
    if (result === "OK") return true;
    // NX lost the race — but if the existing holder is already us (e.g. this poller restarted
    // with the same ownerId before its old lease expired), that's not a loss, just a re-acquire.
    const current = await this.redis.get(this.key(resourceId));
    return current === ownerId;
  }

  async renew(resourceId: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(RENEW_SCRIPT, 1, this.key(resourceId), ownerId, ttlMs);
    return result === 1;
  }

  async release(resourceId: string, ownerId: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, this.key(resourceId), ownerId);
  }
}

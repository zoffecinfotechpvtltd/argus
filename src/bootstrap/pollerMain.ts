// M1: standalone poller process. Saas-mode-only — exe mode is a single process by design (main.ts
// runs its own in-process Scheduler, unchanged). Run N of these against the same Postgres +
// Redis to shard a device fleet across processes; each one leases whichever devices it can and
// gives them up (on graceful stop, or by TTL expiry if killed) for another poller to pick up.
// Unlike main.ts, this process serves no HTTP traffic and never touches bootstrap/singleInstance —
// running multiple of these at once against the same dataDir is the whole point, not a conflict.
import { randomUUID } from "node:crypto";
import { loadConfig } from "@bootstrap/config";
import { buildContainer } from "@bootstrap/container";
import { Scheduler } from "@application/scheduler";
import { RedisLeaseCoordinator } from "@adapters/redis/leaseCoordinator";
import { getRedis } from "@adapters/redis/connection";
import { VERSION } from "@bootstrap/version";

const config = loadConfig(process.env.CONFIG_PATH ?? "./config.json");

if (config.mode !== "saas") {
  // eslint-disable-next-line no-console
  console.error('pollerMain.ts is saas-mode-only (set MODE=saas) — exe mode already polls in-process via main.ts.');
  process.exit(1);
}
if (!config.redis?.url) {
  // eslint-disable-next-line no-console
  console.error("REDIS_URL is required to run a standalone poller process (see docker-compose.yml).");
  process.exit(1);
}

const app = await buildContainer(config);

const pollerId = process.env.POLLER_ID || randomUUID();
app.leaseCoordinator = new RedisLeaseCoordinator(getRedis(config.redis.url));

const scheduler = new Scheduler(app, { pollerId });
await scheduler.start();

app.logger.info("poller_started", { pollerId, version: VERSION });
// eslint-disable-next-line no-console
console.log(`Argus poller ${VERSION} (${pollerId}) — sharded against Postgres + Redis, Ctrl+C to stop`);

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.logger.info("poller_shutting_down", { signal, pollerId });
  scheduler
    .stop()
    .catch((err) => app.logger.error("poller_stop_failed", { error: (err as Error).message }))
    .finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

import type { AppContainer } from "@ports/context";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 5000;

/** Pings app.config.heartbeatUrl (a dead-man's-switch push monitor: healthchecks.io, Cronitor,
 * Uptime Kuma, ...) on a fixed interval. This is the one failure mode nothing else in the product
 * can detect from the inside: if the whole Argus process, the Windows service, or the machine
 * itself goes down, there's no in-process alerting left to fire at all — only an external service
 * watching for a run of missed pings can notice and page someone. Configure the monitor's own
 * grace period comfortably above HEARTBEAT_INTERVAL_MS (e.g. 15-20 min) so one transient miss
 * doesn't false-page. */
export async function sendHeartbeat(app: AppContainer): Promise<void> {
  const url = app.config.heartbeatUrl;
  if (!url) return;

  try {
    await app.externalUrlGuard.assertSafe(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
    if (!res.ok) app.logger.warn("heartbeat_ping_failed", { status: res.status });
  } catch (err) {
    app.logger.warn("heartbeat_ping_failed", { error: (err as Error).message });
  }
}

export class HeartbeatScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private app: AppContainer) {}

  start(): void {
    // Fire once immediately — a fresh restart shouldn't have to wait up to HEARTBEAT_INTERVAL_MS
    // for the first proof-of-life, since a restart is exactly the moment you most want to confirm
    // the URL still works.
    sendHeartbeat(this.app).catch((err) => this.app.logger.error("heartbeat_failed", { error: (err as Error).message }));
    this.timer = setInterval(() => {
      sendHeartbeat(this.app).catch((err) => this.app.logger.error("heartbeat_failed", { error: (err as Error).message }));
    }, HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

import type Redis from "ioredis";
import type { EventBus } from "@ports/services";

/**
 * Saas mode's EventBus: Redis PUBLISH/SUBSCRIBE, so a domain event emitted in one process (a
 * pollerMain.ts poller, an escalation worker, the web app itself) reaches every other process's
 * `.on()` handlers, not just handlers registered in the emitting process. This is the actual fix
 * for M2 — a poller process's `device.status_changed` (src/application/scheduler.ts) previously
 * only ever reached that poller's own private in-memory EventBus, so the web app's SSE bridge
 * (api/server.ts) never saw it no matter how the SSE transport itself was built. Exe mode keeps
 * SimpleEventBus — one process, nothing to cross.
 */
export class RedisEventBus implements EventBus {
  private sub: Redis;
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(
    private pub: Redis,
    private channelPrefix = "argus:events:"
  ) {
    this.sub = pub.duplicate();
    this.sub.on("message", (channel: string, message: string) => {
      const topic = channel.slice(this.channelPrefix.length);
      const set = this.handlers.get(topic);
      if (!set) return;
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }
      for (const h of set) h(payload);
    });
  }

  emit<T>(topic: string, payload: T): void {
    void this.pub.publish(`${this.channelPrefix}${topic}`, JSON.stringify(payload));
  }

  on<T>(topic: string, handler: (payload: T) => void): () => void {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
      void this.sub.subscribe(`${this.channelPrefix}${topic}`);
    }
    const set = this.handlers.get(topic)!;
    set.add(handler as (payload: unknown) => void);
    return () => set.delete(handler as (payload: unknown) => void);
  }
}

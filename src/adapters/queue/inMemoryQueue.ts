import type { Queue } from "@ports/services";

/**
 * The exe's Queue: fan-out is just calling every locally-subscribed handler directly — there's
 * only one process, so there's nothing to actually queue or transport.
 */
export class InMemoryQueue implements Queue {
  private handlers = new Map<string, Set<(payload: unknown) => Promise<void>>>();

  async enqueue<T>(topic: string, payload: T): Promise<void> {
    const set = this.handlers.get(topic);
    if (!set) return;
    await Promise.all([...set].map((h) => h(payload).catch(() => {})));
  }

  subscribe<T>(topic: string, handler: (payload: T) => Promise<void>): void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler as (payload: unknown) => Promise<void>);
  }
}

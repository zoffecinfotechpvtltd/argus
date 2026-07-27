import { describe, expect, test } from "bun:test";
import { InMemoryQueue } from "@adapters/queue/inMemoryQueue";

describe("InMemoryQueue", () => {
  test("delivers an enqueued payload to a subscriber on the same topic", async () => {
    const queue = new InMemoryQueue();
    const received: unknown[] = [];
    queue.subscribe<{ hello: string }>("topic-a", async (payload) => {
      received.push(payload);
    });

    await queue.enqueue("topic-a", { hello: "world" });
    expect(received).toEqual([{ hello: "world" }]);
  });

  test("does not deliver to a different topic", async () => {
    const queue = new InMemoryQueue();
    const received: unknown[] = [];
    queue.subscribe("topic-a", async (p) => {
      received.push(p);
    });

    await queue.enqueue("topic-b", { x: 1 });
    expect(received).toHaveLength(0);
  });

  test("delivers to every subscriber on the topic", async () => {
    const queue = new InMemoryQueue();
    let count = 0;
    queue.subscribe("t", async () => {
      count++;
    });
    queue.subscribe("t", async () => {
      count++;
    });

    await queue.enqueue("t", {});
    expect(count).toBe(2);
  });

  test("a throwing subscriber does not prevent other subscribers from being called", async () => {
    const queue = new InMemoryQueue();
    let secondCalled = false;
    queue.subscribe("t", async () => {
      throw new Error("boom");
    });
    queue.subscribe("t", async () => {
      secondCalled = true;
    });

    await queue.enqueue("t", {});
    expect(secondCalled).toBe(true);
  });

  test("enqueue on a topic with no subscribers is a no-op, not an error", async () => {
    const queue = new InMemoryQueue();
    await expect(queue.enqueue("nobody-listening", { x: 1 })).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from "bun:test";
import { buildTestContainer } from "./helpers/testContainer";
import { sendHeartbeat } from "@application/heartbeatScheduler";

describe("sendHeartbeat", () => {
  it("is a no-op when no heartbeat URL is configured", async () => {
    const { app } = buildTestContainer();
    app.config.heartbeatUrl = "";
    await expect(sendHeartbeat(app)).resolves.toBeUndefined();
  });

  it("never throws even if the configured URL is unreachable", async () => {
    const { app } = buildTestContainer();
    // Port 1 is reserved/unroutable — this call will fail fast, but must fail *inside*
    // sendHeartbeat (caught and logged), never bubble up and take the scheduler's timer down.
    app.config.heartbeatUrl = "https://127.0.0.1:1/heartbeat";
    await expect(sendHeartbeat(app)).resolves.toBeUndefined();
  });
});

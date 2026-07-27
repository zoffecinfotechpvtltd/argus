import { describe, expect, it } from "bun:test";
import { ConfigSchema } from "@bootstrap/config";

describe("ConfigSchema", () => {
  it("applies defaults for an empty config", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("exe");
      expect(result.data.port).toBe(7070);
      expect(result.data.polling.defaultIntervalSec).toBe(60);
      expect(result.data.polling.concurrency).toBe(50);
      expect(result.data.retention.rawDays).toBe(30);
    }
  });

  it("rejects an invalid mode", () => {
    const result = ConfigSchema.safeParse({ mode: "bogus" });
    expect(result.success).toBe(false);
  });

  it("rejects a port outside the valid range", () => {
    const result = ConfigSchema.safeParse({ port: 99999 });
    expect(result.success).toBe(false);
  });

  it("rejects a polling interval below the 10s minimum", () => {
    const result = ConfigSchema.safeParse({ polling: { defaultIntervalSec: 5 } });
    expect(result.success).toBe(false);
  });

  it("coerces string env-style values", () => {
    const result = ConfigSchema.safeParse({ port: "8080" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.port).toBe(8080);
  });

  it("accepts a full valid config", () => {
    const result = ConfigSchema.safeParse({
      mode: "exe",
      port: 8080,
      dataDir: "/var/lib/argus",
      logLevel: "debug",
      polling: { defaultIntervalSec: 30, concurrency: 100 },
      retention: { rawDays: 14, rollupDays: 180 },
    });
    expect(result.success).toBe(true);
  });
});

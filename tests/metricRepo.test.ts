import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { buildTestContainer } from "./helpers/testContainer";
import { DEFAULT_TENANT_ID } from "@domain/entities";

describe("SqliteMetricRepo.percentile95", () => {
  it("returns null when there are no samples in range", async () => {
    const { app } = buildTestContainer();
    const p95 = await app.repos.metric.percentile95(DEFAULT_TENANT_ID, {
      deviceId: randomUUID(),
      name: "if0.inBps",
      from: "2000-01-01T00:00:00.000Z",
      to: "2100-01-01T00:00:00.000Z",
    });
    expect(p95).toBeNull();
  });

  it("computes the 95th-percentile value for a device's named metric, ignoring other devices/names", async () => {
    const { app } = buildTestContainer();
    const deviceId = randomUUID();
    const otherDeviceId = randomUUID();
    const now = new Date();
    const ts = (offsetSec: number) => new Date(now.getTime() + offsetSec * 1000).toISOString();

    const inBpsValues = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100..2000
    await app.repos.metric.insertBatch(
      inBpsValues.map((value, i) => ({
        tenantId: DEFAULT_TENANT_ID,
        deviceId,
        checkId: null,
        ts: ts(i),
        name: "if0.inBps",
        value,
      }))
    );
    // Noise that must not affect the result: a different metric name on the same device, and the
    // same metric name on a different device.
    await app.repos.metric.insertBatch([
      { tenantId: DEFAULT_TENANT_ID, deviceId, checkId: null, ts: ts(0), name: "if0.outBps", value: 999_999 },
      { tenantId: DEFAULT_TENANT_ID, deviceId: otherDeviceId, checkId: null, ts: ts(0), name: "if0.inBps", value: -1 },
    ]);

    const p95 = await app.repos.metric.percentile95(DEFAULT_TENANT_ID, {
      deviceId,
      name: "if0.inBps",
      from: ts(-60),
      to: ts(60),
    });

    // rank = 0.95 * 19 = 18.05 -> interpolate between sorted[18]=1900 and sorted[19]=2000, weight .05
    expect(p95).toBeCloseTo(1905, 6);
  });
});

import { Hono } from "hono";
import { z } from "zod";
import { requireRole, tenantOf } from "@api/middleware/auth";
import { requireAuthOrApiKey } from "@api/middleware/apiKey";
import { validateQuery, getValidatedQuery } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const RANGE_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};
const RAW_CUTOFF_MS = 24 * 60 * 60 * 1000; // ranges at or below this pull raw metrics; longer ranges pull hourly rollups

const MetricsQuerySchema = z.object({
  range: z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h"),
  name: z.string().optional(),
});

const Percentile95QuerySchema = z.object({
  range: z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h"),
  name: z.string().min(1),
});

export function metricsRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get(
    "/metrics/:deviceId",
    requireAuthOrApiKey(app),
    requireRole("viewer"),
    validateQuery(MetricsQuerySchema),
    async (c) => {
      const tenantId = tenantOf(c);
      const deviceId = c.req.param("deviceId")!;
      const { range, name } = getValidatedQuery<typeof MetricsQuerySchema>(c);

      const rangeMs = RANGE_MS[range]!;
      const now = app.clock.now();
      const from = new Date(now.getTime() - rangeMs).toISOString();
      const to = now.toISOString();

      const source = rangeMs <= RAW_CUTOFF_MS ? "raw" : "hourly";
      const rows =
        source === "raw"
          ? await app.repos.metric.queryRaw(tenantId, { deviceId, name, from, to })
          : await app.repos.metric.queryHourly(tenantId, { deviceId, name, from, to });

      return c.json({ source, range, from, to, points: rows });
    }
  );

  // 95th-percentile value for a single named metric over the range — e.g. "typical peak"
  // bandwidth (if0.inBps/outBps), far more useful than a plain max() since it shrugs off one-off
  // spikes. Always computed from raw samples (not hourly rollups), since the rollup table only
  // stores avg/min/max per hour, not a distribution a percentile could be taken over.
  router.get(
    "/metrics/:deviceId/percentile95",
    requireAuthOrApiKey(app),
    requireRole("viewer"),
    validateQuery(Percentile95QuerySchema),
    async (c) => {
      const tenantId = tenantOf(c);
      const deviceId = c.req.param("deviceId")!;
      const { range, name } = getValidatedQuery<typeof Percentile95QuerySchema>(c);

      const rangeMs = RANGE_MS[range]!;
      const now = app.clock.now();
      const from = new Date(now.getTime() - rangeMs).toISOString();
      const to = now.toISOString();

      const p95 = await app.repos.metric.percentile95(tenantId, { deviceId, name, from, to });
      return c.json({ range, from, to, name, p95 });
    }
  );

  // Prometheus text-exposition format (https://prometheus.io/docs/instrumenting/exposition_formats/)
  // — lets an external Prometheus server scrape fleet state directly, no Argus-specific exporter
  // needed. Gated the same as every other read route (session or a read-only API key); Prometheus's
  // own `bearer_token`/`bearer_token_file` scrape-config options are exactly what an API key here is for.
  router.get("/metrics/prometheus", requireAuthOrApiKey(app), requireRole("viewer"), async (c) => {
    const tenantId = tenantOf(c);
    const page = await app.repos.device.listWithStatus(tenantId, { limit: 10_000 });

    const lines: string[] = [
      "# HELP argus_device_up 1 if the device's last check passed, 0 otherwise (degraded/down/flapping all count as 0)",
      "# TYPE argus_device_up gauge",
    ];
    for (const d of page.items) {
      lines.push(`argus_device_up{device="${escapeLabel(d.name)}",ip="${d.ip}"} ${d.state === "up" ? 1 : 0}`);
    }

    lines.push("# HELP argus_device_latency_ms Last observed check latency in milliseconds", "# TYPE argus_device_latency_ms gauge");
    for (const d of page.items) {
      if (d.lastLatencyMs != null) lines.push(`argus_device_latency_ms{device="${escapeLabel(d.name)}",ip="${d.ip}"} ${d.lastLatencyMs}`);
    }

    return c.text(lines.join("\n") + "\n", 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  });

  return router;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

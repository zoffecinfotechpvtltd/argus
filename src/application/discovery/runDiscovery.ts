import { randomUUID } from "node:crypto";
import type { AppContainer } from "@ports/context";
import type { DiscoveryJob } from "@ports/services";

/** Kicks off an async subnet scan; progress and completion are emitted on the "discovery" event topic for the WS layer to broadcast. */
export function startDiscoveryJob(app: AppContainer, tenantId: string, cidr: string, snmpCommunity?: string): DiscoveryJob {
  const job: DiscoveryJob = {
    id: randomUUID(),
    tenantId,
    cidr,
    status: "running",
    scanned: 0,
    total: 0,
    results: [],
    startedAt: app.clock.nowIso(),
  };
  app.discoveryJobs.create(job);

  app.scanner
    .scan({
      cidr,
      snmpCommunity,
      concurrency: app.config.polling.concurrency,
      onProgress: (progress) => {
        app.discoveryJobs.update(job.id, { scanned: progress.scanned, total: progress.total, results: progress.found });
        app.events.emit("discovery.progress", {
          jobId: job.id,
          tenantId,
          scanned: progress.scanned,
          total: progress.total,
          foundCount: progress.found.length,
        });
      },
    })
    .then((results) => {
      app.discoveryJobs.update(job.id, { status: "done", results, finishedAt: app.clock.nowIso() });
      app.events.emit("discovery.done", { jobId: job.id, tenantId, count: results.length });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      app.discoveryJobs.update(job.id, { status: "error", error: message, finishedAt: app.clock.nowIso() });
      app.events.emit("discovery.error", { jobId: job.id, tenantId, error: message });
    });

  return job;
}

export function getDiscoveryJob(app: AppContainer, tenantId: string, jobId: string): DiscoveryJob | undefined {
  return app.discoveryJobs.get(tenantId, jobId);
}

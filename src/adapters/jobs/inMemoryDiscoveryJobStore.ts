import type { DiscoveryJob, DiscoveryJobStore } from "@ports/services";

/** Transient in-process job registry — fine for the single-process exe. */
export class InMemoryDiscoveryJobStore implements DiscoveryJobStore {
  private jobs = new Map<string, DiscoveryJob>();

  create(job: DiscoveryJob): void {
    this.jobs.set(job.id, job);
  }

  get(tenantId: string, id: string): DiscoveryJob | undefined {
    const job = this.jobs.get(id);
    if (!job || job.tenantId !== tenantId) return undefined;
    return job;
  }

  update(id: string, patch: Partial<DiscoveryJob>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
  }
}

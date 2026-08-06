// Plain config shape — no zod, no I/O. bootstrap/config.ts validates raw input into this shape.
export interface AppConfig {
  /** "exe" = single-tenant Windows exe, SQLite (unchanged, the existing self-host path) — this is
   * the shipped, sold product; see GUIDE.md.
   * "saas" = multi-tenant Postgres deployment — a separate hosted-mode path, not part of the
   * single-instance product GUIDE.md documents. */
  mode: "exe" | "saas";
  port: number;
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  instanceName: string;
  /** Static JSON URL to check for newer releases against (Settings -> About). Off by default. */
  updateCheckUrl?: string;
  /** Dead-man's-switch URL (e.g. a healthchecks.io/Cronitor/Uptime-Kuma push-monitor ping URL) —
   * pinged on a fixed interval by HeartbeatScheduler. Solves the one failure mode nothing else in
   * this file can: if the whole Argus process/service (or the machine it runs on) goes down, there
   * is no in-process alerting left to fire — only an external service watching for missed pings
   * can notice. Off by default, same reasoning as updateCheckUrl. */
  heartbeatUrl?: string;
  polling: {
    defaultIntervalSec: number;
    concurrency: number;
  };
  retention: {
    rawDays: number;
    rollupDays: number;
  };
  /** Required when mode === "saas", ignored otherwise. */
  postgres?: {
    url: string;
  };
  /** Required when mode === "saas" (M1's lease coordinator + M2's pub/sub event fan-out both need
   * it), ignored otherwise. */
  redis?: {
    url: string;
  };
}

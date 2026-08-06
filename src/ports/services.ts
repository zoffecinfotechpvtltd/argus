import type { Alert, CheckKind, Device, DeviceStatus, DiscoveredDevice, DiscoveryProgress, Metric, NotificationChannel } from "@domain/entities";
import type { LicenseState } from "@domain/license";

export interface Clock {
  now(): Date;
  nowIso(): string;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  values?: Record<string, number>;
  error?: string;
  /** Non-numeric device identity facts a vendor-API checker learned this poll (model, firmware,
   * serial, HA role) — the scheduler persists these onto the Device record. Only set when at least
   * one fact was actually read back; omitted (not present with undefined fields) otherwise. */
  deviceFacts?: {
    model?: string;
    firmwareVersion?: string;
    serialNumber?: string;
    haRole?: "primary" | "secondary";
  };
}

export interface Checker {
  run(device: Device, check: import("@domain/entities").Check): Promise<CheckResult>;
}

export interface NotifyPayload {
  alert: Alert;
  device: Device;
  tenantId: string;
  ackUrl?: string;
  /** Set only for a storm/aggregate notification (alertEngine.ts's sendStormNotification) — every
   * individual device caught in that storm, so the notification can list each one explicitly
   * instead of leaving the recipient to guess who's actually down from a single representative
   * `device` field. Undefined for a normal single-device alert. */
  affectedDevices?: Array<{ name: string; ip: string }>;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
}

export interface Notifier {
  channel: NotificationChannel;
  send(target: string, payload: NotifyPayload): Promise<NotifyResult>;
  sendTest(tenantId: string, target: string): Promise<NotifyResult>;
}

export interface Queue {
  enqueue<T>(topic: string, payload: T): Promise<void>;
  subscribe<T>(topic: string, handler: (payload: T) => Promise<void>): void;
}

export interface EventBus {
  emit<T>(topic: string, payload: T): void;
  on<T>(topic: string, handler: (payload: T) => void): () => void;
}

export interface DiscoveryScanOptions {
  cidr: string;
  snmpCommunity?: string;
  concurrency?: number;
  onProgress?: (progress: DiscoveryProgress) => void;
}

export interface NetworkScanner {
  scan(opts: DiscoveryScanOptions): Promise<DiscoveredDevice[]>;
}

export type DiscoveryJobStatus = "running" | "done" | "error";

export interface DiscoveryJob {
  id: string;
  tenantId: string;
  cidr: string;
  status: DiscoveryJobStatus;
  scanned: number;
  total: number;
  results: DiscoveredDevice[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface DiscoveryJobStore {
  create(job: DiscoveryJob): void;
  get(tenantId: string, id: string): DiscoveryJob | undefined;
  update(id: string, patch: Partial<DiscoveryJob>): void;
}

export interface CheckerProvider {
  get(kind: CheckKind): Checker;
}

export interface StateTransitionRecord {
  tenantId: string;
  deviceId: string;
  newState: string;
  atIso: string;
}

/** Atomically persists one scheduler tick's worth of status updates, metric inserts, and durable state-history transitions in a single transaction. */
export interface TickPersister {
  persist(statusUpdates: DeviceStatus[], metrics: Metric[], transitions?: StateTransitionRecord[]): Promise<void>;
}

/** Signs/verifies the one-click alert-acknowledgement URL token. HMAC-based, no DB round trip needed to verify. */
export interface TokenSigner {
  signAckToken(alertId: string, ttlMs: number): string;
  verifyAckToken(alertId: string, token: string): boolean;
}

export interface NotifierRegistry {
  get(channel: NotificationChannel): Notifier;
}

/** Flushes the WAL into the main DB file — needed before copying/zipping the SQLite file directly for backup. */
export interface DbMaintenance {
  checkpoint(): void;
  /** Closes the underlying connection — required before overwriting the db file on disk (e.g. restore), since Windows refuses to rename/replace a file with an open handle. */
  close(): void;
  /** Builds a zip archive from raw file entries — exposed here (rather than application/ importing
   * the zip adapter directly) so both the manual backup route and the scheduled backup job in
   * application/ can produce identical archives without application/ reaching into adapters/. */
  buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer;
}

/** Encrypts/decrypts small secrets (SNMP community strings, etc.) at rest using the instance key —
 * a port so application/ code (e.g. the discovery-schedule runner) never needs to import the
 * crypto adapter directly. */
export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** SSRF guard for any admin-configured "call out to an external URL" setting (update feed,
 * heartbeat dead-man's-switch, ...) — a port so application/ code (e.g. HeartbeatScheduler) never
 * needs to import the DNS-resolving adapter directly. Rejects (throws) rather than returning a
 * boolean so the caller's own error message doesn't have to be reconstructed from a bare `false`. */
export interface ExternalUrlGuard {
  assertSafe(url: string): Promise<void>;
}

export interface SystemEmailResult {
  ok: boolean;
  error?: string;
}

/** Transactional/system email (password reset links, scheduled digests) — distinct from the
 * per-alert Notifier port above, which is scoped to alert payloads specifically. */
export interface SystemEmailSender {
  send(tenantId: string, opts: { to: string; subject: string; text: string; html: string }): Promise<SystemEmailResult>;
}

/** Forwards a CEF-formatted alert to a UDP syslog endpoint if the admin has configured and enabled
 * one — a no-op if unconfigured. Exists as a port so the alert engine (application/) never imports
 * the syslog/dgram adapter directly. */
export interface SyslogForwarder {
  forward(tenantId: string, alert: { title: string; severity: import("@domain/entities").AlertSeverity; deviceId: string; conditionKey: string }, deviceName: string): Promise<void>;
}

/** Read-only view of the scheduler's last tick time, for the "engine lagging" UI indicator. Wired post-construction (see bootstrap/main.ts) since the scheduler is built after the container. */
export interface EngineHeartbeat {
  lastTickAt(): number;
}

/** Requests a graceful app shutdown. A no-op stub at container construction time, replaced with
 * the real shutdown() function in bootstrap/main.ts once it exists — same replace-after-construction
 * pattern EngineHeartbeat uses. Used by self-update (bootstrap/selfUpdate.ts) to hand off to the
 * OS-level swap-and-relaunch script only after the current process has actually exited. */
export interface ShutdownRequester {
  requestShutdown(reason: string): void;
}

/** License state — exe mode reads a signed file on disk (tenantId ignored, there's only ever one
 * tenant); saas mode reads the calling tenant's plan row from Postgres (tenantId required there).
 * Async uniformly so both implementations satisfy one interface without a sync/async split. */
export interface LicenseService {
  getState(tenantId?: string): Promise<LicenseState>;
  /** Re-reads and re-verifies the license file from disk. Exe-mode-only; saas mode's tenant-plan
   * rows are always read fresh, nothing to reload. */
  reload(): void;
  /** Verifies, persists to disk, and reloads. Throws if the file's signature doesn't verify.
   * Exe-mode-only (saas mode's plan comes from the tenant row / billing system, not a license file
   * a user uploads) — saas's implementation throws if this is ever called. */
  applyLicenseFile(raw: string): Promise<LicenseState>;
}

/**
 * M1: distributed ownership of a shardable resource (currently: "which poller process polls this
 * device") via short-lived leases, so N poller processes can split a device fleet without a central
 * scheduler — a lease's owner is authoritative until it expires or is renewed by someone else.
 * Undefined in exe mode's AppContainer (single process, nothing to shard — Scheduler falls back to
 * unconditional local ownership of every device when this port isn't wired, see scheduler.ts).
 */
export interface LeaseCoordinator {
  /** True if this owner now holds (or already held) the lease. False if another owner holds it. */
  acquire(resourceId: string, ownerId: string, ttlMs: number): Promise<boolean>;
  /** Extends the lease's TTL, but only if `ownerId` is still the current holder. False means the
   * lease was lost (expired and taken by someone else, or never held) — caller must stop treating
   * the resource as owned. */
  renew(resourceId: string, ownerId: string, ttlMs: number): Promise<boolean>;
  /** Releases the lease, but only if `ownerId` is still the current holder (a graceful-shutdown
   * hand-off; never removes a lease this owner has already lost). */
  release(resourceId: string, ownerId: string): Promise<void>;
}

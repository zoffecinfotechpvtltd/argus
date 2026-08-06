// Exe-mode-only container builder — deliberately imports ONLY the SQLite adapters, never
// anything under @adapters/db/postgres or @adapters/redis. bootstrap/container.ts (the original,
// still used by src/bootstrap/main.ts when run from source for the separate saas/Docker
// deployment — see Dockerfile) statically imports both the SQLite and Postgres/Redis adapter
// sets; `bun build --compile` traces main.ts's whole import graph regardless of which branch
// `config.mode` picks at runtime, so the shipped Windows exe was bundling `pg`, `ioredis`, and 13
// Postgres repo files it can never actually use. This file exists so the exe's own entry point
// (bootstrap/mainExe.ts, see package.json's `compile` script) never references any of that in the
// first place — nothing to trace, nothing to bundle. Keep this in sync with buildSqliteContainer
// in container.ts if the exe-mode container shape ever changes; the two are intentionally
// duplicated rather than shared, since sharing would mean importing from container.ts and
// reintroducing the exact problem this file exists to avoid.
import type { AppConfig } from "@bootstrap/config";
import { loadOrCreateInstanceKey } from "@bootstrap/config";
import { getDb, runMigrations } from "@adapters/db/sqlite/connection";
import { MIGRATIONS } from "@generated/migrationsManifest";
import { SqliteCheckRepo, SqliteDeviceRepo, SqliteGroupRepo, SqliteStatusRepo } from "@adapters/db/sqlite/deviceRepos";
import { SqliteAlertRepo, SqliteMetricRepo, SqliteNotificationLogRepo } from "@adapters/db/sqlite/metricAlertRepos";
import { SqliteSessionRepo, SqliteUserRepo } from "@adapters/db/sqlite/authRepos";
import { SqliteAuditRepo, SqliteMaintenanceRepo, SqliteNotificationPrefsRepo, SqliteSettingsRepo } from "@adapters/db/sqlite/miscRepos";
import { SqliteAlertNoteRepo, SqliteApiKeyRepo, SqliteDiscoveryScheduleRepo, SqliteOnCallScheduleRepo } from "@adapters/db/sqlite/enterpriseRepos";
import { SqliteTickPersister } from "@adapters/db/sqlite/tickPersister";
import { SqliteHistoryRepo, SqliteTopologyRepo } from "@adapters/db/sqlite/reportingRepos";
import { SqliteTenantRepo } from "@adapters/db/sqlite/tenantRepos";
import { SqliteDbMaintenance } from "@adapters/db/sqlite/maintenance";
import { SystemClock } from "@adapters/clock";
import { JsonLogger } from "@adapters/logger";
import { SubnetScanner } from "@adapters/net/discovery";
import { DefaultCheckerProvider } from "@adapters/net/checkers/registry";
import { InMemoryDiscoveryJobStore } from "@adapters/jobs/inMemoryDiscoveryJobStore";
import { DefaultNotifierRegistry } from "@adapters/notify/registry";
import { DefaultSystemEmailSender } from "@adapters/notify/systemEmail";
import { DefaultSyslogForwarder } from "@adapters/notify/syslogForwarder";
import { HmacAckTokenSigner, InstanceKeySecretCipher } from "@adapters/crypto";
import { DnsResolvingExternalUrlGuard } from "@adapters/net/externalUrlGuard";
import { FileLicenseService } from "@adapters/license";
import { LICENSE_PUBLIC_KEY_PEM } from "@domain/licensePublicKey";
import { InMemoryQueue } from "@adapters/queue/inMemoryQueue";
import type { EventBus } from "@ports/services";
import type { AppContainer } from "@ports/context";

class SimpleEventBus implements EventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  emit<T>(topic: string, payload: T): void {
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const h of set) h(payload);
  }

  on<T>(topic: string, handler: (payload: T) => void): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    const set = this.handlers.get(topic)!;
    set.add(handler as (payload: unknown) => void);
    return () => set.delete(handler as (payload: unknown) => void);
  }
}

let container: AppContainer | null = null;

export function buildExeContainer(config: AppConfig): AppContainer {
  if (container) return container;

  const logger = new JsonLogger(config.logLevel, config.dataDir);
  const clock = new SystemClock();
  const instanceKey = loadOrCreateInstanceKey(config.dataDir);

  const db = getDb(config.dataDir);
  const applied = runMigrations(db, MIGRATIONS);
  if (applied.length > 0) logger.info("Migrations applied", { migrations: applied });

  // Argus has exactly one tenant ("local", the DEFAULT_TENANT_ID) — every repo method still takes
  // a tenantId parameter (shared shape with the schema's original multi-tenant design), but there's
  // no signup/provisioning flow; this is the one-time seed for that fixed row. Ensured lazily here
  // (synchronously — bun:sqlite has no async I/O) rather than in a migration, so it works the same
  // for a fresh install and an upgrade from an older db.
  const existing = db.query<any, any>("SELECT id FROM tenants WHERE id='local'").get();
  if (!existing) {
    db.query<any, any>("INSERT INTO tenants (id, name, plan, created_at) VALUES ('local', $name, 'enterprise', $created_at)").run({
      $name: config.instanceName,
      $created_at: clock.nowIso(),
    });
  }

  container = {
    config,
    clock,
    logger,
    instanceKey,
    events: new SimpleEventBus(),
    queue: new InMemoryQueue(),
    scanner: new SubnetScanner(),
    discoveryJobs: new InMemoryDiscoveryJobStore(),
    checkers: new DefaultCheckerProvider(instanceKey),
    tickPersister: new SqliteTickPersister(db),
    notifiers: new DefaultNotifierRegistry(new SqliteSettingsRepo(db), `http://localhost:${config.port}`, instanceKey),
    tokenSigner: new HmacAckTokenSigner(instanceKey),
    engineHeartbeat: { lastTickAt: () => Date.now() }, // replaced once the scheduler starts (see bootstrap/mainExe.ts)
    dbMaintenance: new SqliteDbMaintenance(db),
    license: new FileLicenseService(config.dataDir, LICENSE_PUBLIC_KEY_PEM, clock),
    shutdownRequester: { requestShutdown: () => {} }, // replaced once shutdown() exists (see bootstrap/mainExe.ts)
    secretCipher: new InstanceKeySecretCipher(instanceKey),
    externalUrlGuard: new DnsResolvingExternalUrlGuard(),
    systemEmail: new DefaultSystemEmailSender(new SqliteSettingsRepo(db), instanceKey),
    syslogForwarder: new DefaultSyslogForwarder(new SqliteSettingsRepo(db), logger),
    repos: {
      device: new SqliteDeviceRepo(db),
      group: new SqliteGroupRepo(db),
      check: new SqliteCheckRepo(db),
      status: new SqliteStatusRepo(db),
      metric: new SqliteMetricRepo(db),
      alert: new SqliteAlertRepo(db),
      user: new SqliteUserRepo(db),
      session: new SqliteSessionRepo(db),
      settings: new SqliteSettingsRepo(db),
      audit: new SqliteAuditRepo(db),
      maintenance: new SqliteMaintenanceRepo(db),
      notificationPrefs: new SqliteNotificationPrefsRepo(db),
      notificationLog: new SqliteNotificationLogRepo(db),
      history: new SqliteHistoryRepo(db),
      topology: new SqliteTopologyRepo(db),
      tenant: new SqliteTenantRepo(db),
      alertNote: new SqliteAlertNoteRepo(db),
      apiKey: new SqliteApiKeyRepo(db),
      discoverySchedule: new SqliteDiscoveryScheduleRepo(db),
      onCallSchedule: new SqliteOnCallScheduleRepo(db),
    },
  };
  return container;
}

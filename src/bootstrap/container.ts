import { join } from "node:path";
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
import { getPgPool, loadPgMigrationsFromDir, runPgMigrations } from "@adapters/db/postgres/connection";
import { PgTenantRepo } from "@adapters/db/postgres/tenantRepos";
import { PgUserRepo, PgSessionRepo } from "@adapters/db/postgres/authRepos";
import { PgSettingsRepo, PgAuditRepo, PgMaintenanceRepo, PgNotificationPrefsRepo } from "@adapters/db/postgres/miscRepos";
import { PgDeviceRepo, PgCheckRepo, PgStatusRepo, PgGroupRepo } from "@adapters/db/postgres/deviceRepos";
import { PgAlertRepo, PgNotificationLogRepo, PgAlertNoteRepo } from "@adapters/db/postgres/alertRepos";
import { PgTenantLicenseService } from "@adapters/db/postgres/tenantLicenseService";
import { PgTickPersister } from "@adapters/db/postgres/tickPersister";
import { notYetPortedRepo } from "@adapters/db/postgres/notImplemented";
import { PgApiKeyRepo, PgDiscoveryScheduleRepo } from "@adapters/db/postgres/enterpriseRepos";
import { PgHistoryRepo } from "@adapters/db/postgres/reportingRepos";
import { PgMetricRepo } from "@adapters/db/postgres/metricRepo";
import { getRedis } from "@adapters/redis/connection";
import { RedisEventBus } from "@adapters/redis/eventBus";
import { PgOnCallScheduleRepo } from "@adapters/db/postgres/onCallRepos";

export type { AppContainer };

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

/** Async uniformly (even though the SQLite path resolves instantly) so the caller in
 * bootstrap/main.ts always awaits full readiness — saas mode's Postgres migrations are genuinely
 * async and must finish before any request is served, so there's no honest synchronous version
 * of this function once a second mode exists. */
export async function buildContainer(config: AppConfig): Promise<AppContainer> {
  if (container) return container;
  container = config.mode === "saas" ? await buildPostgresContainer(config) : buildSqliteContainer(config);
  return container;
}

function buildSqliteContainer(config: AppConfig): AppContainer {
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

  return {
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
    engineHeartbeat: { lastTickAt: () => Date.now() }, // replaced once the scheduler starts (see bootstrap/main.ts)
    dbMaintenance: new SqliteDbMaintenance(db),
    license: new FileLicenseService(config.dataDir, LICENSE_PUBLIC_KEY_PEM, clock),
    shutdownRequester: { requestShutdown: () => {} }, // replaced once shutdown() exists (see bootstrap/main.ts)
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
}

/**
 * Saas mode (M0) — Postgres-backed, multi-tenant. Only the repos/ports M0's own verification test
 * exercises (tenant/user/session/settings/audit/device + the tenant-plan license service) have
 * real implementations; everything else is `notYetPortedRepo` — a loud, specific error on first
 * use, not a silent wrong answer or a blocked build. See SAAS_GAPS.md for the per-milestone list
 * of what ports each remaining repo. Instance-wide secret key reused from the exe-mode loader
 * (`loadOrCreateInstanceKey`, mode-agnostic — just reads/writes a file under `dataDir`, which in
 * Docker is a mounted volume) — a single shared key across all tenants is a known simplification,
 * not a per-tenant isolation model; revisit if/when that's a real product requirement, not before.
 */
async function buildPostgresContainer(config: AppConfig): Promise<AppContainer> {
  if (!config.postgres?.url) throw new Error('config.postgres.url (or DATABASE_URL) is required when mode is "saas"');

  const logger = new JsonLogger(config.logLevel, config.dataDir);
  const clock = new SystemClock();
  const instanceKey = loadOrCreateInstanceKey(config.dataDir);

  const db = getPgPool(config.postgres.url);
  // Awaited before the container is handed back — bootstrap/main.ts can't bind the HTTP server
  // (and therefore can't serve a single request) until this resolves, so no request can ever race
  // a not-yet-migrated schema.
  const applied = await runPgMigrations(db, loadPgMigrationsFromDir(join(import.meta.dir, "..", "..", "migrations-pg")));
  if (applied.length > 0) logger.info("Postgres migrations applied", { migrations: applied });

  const settingsRepo = new PgSettingsRepo(db);

  // M1/M2: domain events (device.status_changed from a pollerMain.ts poller, alert.changed, etc.)
  // must cross process boundaries — a poller is always a separate OS process from the web app, and
  // the web app itself may run as multiple replicas. Falls back to SimpleEventBus (same as exe
  // mode) when REDIS_URL isn't set, so saas mode still boots without Redis for anyone not running
  // sharded pollers or SSE fan-out yet — but note pollerMain.ts itself already requires Redis
  // unconditionally (see bootstrap/pollerMain.ts), so in practice any deployment running M1 pollers
  // has Redis configured and gets this for free.
  const events = config.redis?.url ? new RedisEventBus(getRedis(config.redis.url)) : new SimpleEventBus();

  const appContainer: AppContainer = {
    config,
    clock,
    logger,
    instanceKey,
    events,
    queue: new InMemoryQueue(),
    scanner: new SubnetScanner(),
    discoveryJobs: new InMemoryDiscoveryJobStore(),
    checkers: new DefaultCheckerProvider(instanceKey),
    tickPersister: new PgTickPersister(db),
    notifiers: new DefaultNotifierRegistry(settingsRepo, `http://localhost:${config.port}`, instanceKey),
    tokenSigner: new HmacAckTokenSigner(instanceKey),
    engineHeartbeat: { lastTickAt: () => Date.now() },
    dbMaintenance: notYetPortedRepo("DbMaintenance"), // pg_dump-based backup story, not yet designed — see SAAS_GAPS.md
    license: new PgTenantLicenseService(db),
    shutdownRequester: { requestShutdown: () => {} },
    secretCipher: new InstanceKeySecretCipher(instanceKey),
    externalUrlGuard: new DnsResolvingExternalUrlGuard(),
    systemEmail: new DefaultSystemEmailSender(settingsRepo, instanceKey),
    syslogForwarder: new DefaultSyslogForwarder(settingsRepo, logger),
    repos: {
      device: new PgDeviceRepo(db),
      group: new PgGroupRepo(db),
      check: new PgCheckRepo(db),
      status: new PgStatusRepo(db),
      metric: new PgMetricRepo(db), // M5 (query side — inserts already go through PgTickPersister)
      alert: new PgAlertRepo(db),
      user: new PgUserRepo(db),
      session: new PgSessionRepo(db),
      settings: settingsRepo,
      audit: new PgAuditRepo(db),
      maintenance: new PgMaintenanceRepo(db),
      notificationPrefs: new PgNotificationPrefsRepo(db),
      notificationLog: new PgNotificationLogRepo(db),
      history: new PgHistoryRepo(db), // M6 reports
      topology: notYetPortedRepo("TopologyRepo"), // M7
      tenant: new PgTenantRepo(db),
      alertNote: new PgAlertNoteRepo(db),
      apiKey: new PgApiKeyRepo(db),
      discoverySchedule: new PgDiscoveryScheduleRepo(db),
      onCallSchedule: new PgOnCallScheduleRepo(db),
    },
  };

  return appContainer;
}

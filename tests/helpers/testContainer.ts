import { Database } from "bun:sqlite";
import { join } from "node:path";
import { loadMigrationsFromDir, runMigrations } from "@adapters/db/sqlite/connection";
import { SqliteCheckRepo, SqliteDeviceRepo, SqliteGroupRepo, SqliteStatusRepo } from "@adapters/db/sqlite/deviceRepos";
import { SqliteAlertRepo, SqliteMetricRepo, SqliteNotificationLogRepo } from "@adapters/db/sqlite/metricAlertRepos";
import { SqliteSessionRepo, SqliteUserRepo } from "@adapters/db/sqlite/authRepos";
import { SqliteAuditRepo, SqliteMaintenanceRepo, SqliteNotificationPrefsRepo, SqliteSettingsRepo } from "@adapters/db/sqlite/miscRepos";
import { SqliteAlertNoteRepo, SqliteApiKeyRepo, SqliteDiscoveryScheduleRepo, SqliteOnCallScheduleRepo } from "@adapters/db/sqlite/enterpriseRepos";
import { SqliteTickPersister } from "@adapters/db/sqlite/tickPersister";
import { SqliteHistoryRepo, SqliteTopologyRepo } from "@adapters/db/sqlite/reportingRepos";
import { SqliteTenantRepo } from "@adapters/db/sqlite/tenantRepos";
import { SqliteDbMaintenance } from "@adapters/db/sqlite/maintenance";
import { InMemoryQueue } from "@adapters/queue/inMemoryQueue";
import { FakeClock } from "@adapters/clock";
import { HmacAckTokenSigner, InstanceKeySecretCipher } from "@adapters/crypto";
import { DefaultSnmpIdentityProber } from "@adapters/net/snmpProbe";
import { DefaultSystemEmailSender } from "@adapters/notify/systemEmail";
import { DefaultSyslogForwarder } from "@adapters/notify/syslogForwarder";
import type { AppContainer } from "@ports/context";
import type { Checker, ExternalUrlGuard, LicenseService, Notifier, NotifierRegistry } from "@ports/services";
import type { LicenseState } from "@domain/license";

const noopNotifier: Notifier = {
  channel: "email",
  send: async () => ({ ok: true }),
  sendTest: async () => ({ ok: true }),
};

const defaultNotifiers: NotifierRegistry = { get: () => noopNotifier };

/** Permissive by default (unlimited devices, no expiry) so exe-mode tests that create many devices
 * aren't affected by license gating unless a test explicitly opts into a specific LicenseState. */
function buildStubLicenseService(initial: LicenseState): LicenseService {
  let state = initial;
  return {
    getState: async () => state,
    reload: () => {},
    applyLicenseFile: async (raw: string) => {
      state = { status: "valid", payload: JSON.parse(Buffer.from(raw.split(".")[0]!, "base64url").toString("utf-8")) };
      return state;
    },
  };
}

const UNLIMITED_LICENSE: LicenseState = {
  status: "valid",
  payload: { licenseId: "test", customer: "Test", plan: "unlimited", deviceLimit: Number.MAX_SAFE_INTEGER, issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2999-01-01T00:00:00.000Z" },
};

/** Builds a full in-memory-SQLite AppContainer for tests. Pass a Checker to stub out real network I/O, or license to test exe-mode license gating specifically. */
export function buildTestContainer(
  opts: { checker?: Checker; notifiers?: NotifierRegistry; license?: LicenseState } = {}
): { app: AppContainer; db: Database; clock: FakeClock } {
  const db = new Database(":memory:");
  runMigrations(db, loadMigrationsFromDir(join(import.meta.dir, "..", "..", "migrations")));

  const defaultChecker: Checker = { run: async () => ({ ok: true, latencyMs: 5 }) };
  const checker = opts.checker ?? defaultChecker;

  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const clock = new FakeClock(new Date());

  const app = {
    config: {
      mode: "exe",
      port: 58070,
      dataDir: "./data",
      logLevel: "info",
      instanceName: "Test",
      polling: { defaultIntervalSec: 60, concurrency: 50 },
      retention: { rawDays: 30, rollupDays: 365 },
      heartbeatUrl: "",
    },
    clock,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    instanceKey: Buffer.alloc(32),
    events: {
      emit: (topic: string, payload: unknown) => handlers.get(topic)?.forEach((h) => h(payload)),
      on: (topic: string, handler: (p: unknown) => void) => {
        if (!handlers.has(topic)) handlers.set(topic, new Set());
        handlers.get(topic)!.add(handler);
        return () => handlers.get(topic)!.delete(handler);
      },
    },
    queue: new InMemoryQueue(),
    scanner: { scan: async () => [] },
    discoveryJobs: { create() {}, get: () => undefined, update() {} },
    checkers: { get: () => checker },
    tickPersister: new SqliteTickPersister(db),
    notifiers: opts.notifiers ?? defaultNotifiers,
    tokenSigner: new HmacAckTokenSigner(Buffer.alloc(32)),
    engineHeartbeat: { lastTickAt: () => Date.now() },
    dbMaintenance: new SqliteDbMaintenance(db),
    license: buildStubLicenseService(opts.license ?? UNLIMITED_LICENSE),
    shutdownRequester: { requestShutdown: () => {} },
    secretCipher: new InstanceKeySecretCipher(Buffer.alloc(32)),
    snmpIdentityProber: new DefaultSnmpIdentityProber(),
    // Real DNS-resolving guard would try to hit the network for every test that touches a
    // heartbeat/update-check route — tests don't exercise the SSRF-rejection path itself (that's
    // externalUrlGuard's own unit tests' job), so a stub that always allows is correct here.
    externalUrlGuard: { assertSafe: async () => {} } satisfies ExternalUrlGuard,
    systemEmail: new DefaultSystemEmailSender(new SqliteSettingsRepo(db), Buffer.alloc(32)),
    syslogForwarder: new DefaultSyslogForwarder(new SqliteSettingsRepo(db), { debug() {}, info() {}, warn() {}, error() {} }),
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
  } as unknown as AppContainer;

  return { app, db, clock };
}

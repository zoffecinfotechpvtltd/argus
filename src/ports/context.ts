// The composition-root shape. application/ and domain/ may depend on this type (and only this type)
// to reach every capability they need — never on the concrete adapters/bootstrap wiring that builds it.
import type { AppConfig } from "@ports/config";
import type {
  CheckerProvider,
  Clock,
  DbMaintenance,
  DiscoveryJobStore,
  EngineHeartbeat,
  EventBus,
  ExternalUrlGuard,
  LeaseCoordinator,
  LicenseService,
  Logger,
  NetworkScanner,
  NotifierRegistry,
  Queue,
  SecretCipher,
  ShutdownRequester,
  SnmpIdentityProber,
  SyslogForwarder,
  SystemEmailSender,
  TickPersister,
  TokenSigner,
} from "@ports/services";
import type {
  AlertNoteRepo,
  AlertRepo,
  ApiKeyRepo,
  AuditRepo,
  CheckRepo,
  DeviceRepo,
  DiscoveryScheduleRepo,
  GroupRepo,
  HistoryRepo,
  MaintenanceRepo,
  MetricRepo,
  NotificationLogRepo,
  NotificationPrefsRepo,
  OnCallScheduleRepo,
  SessionRepo,
  SettingsRepo,
  StatusRepo,
  TenantRepo,
  TopologyRepo,
  UserRepo,
} from "@ports/repos";

export interface AppContainer {
  config: AppConfig;
  clock: Clock;
  logger: Logger;
  instanceKey: Buffer;
  events: EventBus;
  queue: Queue;
  scanner: NetworkScanner;
  discoveryJobs: DiscoveryJobStore;
  checkers: CheckerProvider;
  tickPersister: TickPersister;
  notifiers: NotifierRegistry;
  tokenSigner: TokenSigner;
  engineHeartbeat: EngineHeartbeat;
  dbMaintenance: DbMaintenance;
  license: LicenseService;
  shutdownRequester: ShutdownRequester;
  secretCipher: SecretCipher;
  snmpIdentityProber: SnmpIdentityProber;
  externalUrlGuard: ExternalUrlGuard;
  systemEmail: SystemEmailSender;
  syslogForwarder: SyslogForwarder;
  /** M1: undefined in exe mode (single process, nothing to shard) and in the saas-mode API process
   * (polling is delegated entirely to standalone pollerMain.ts processes — see bootstrap/main.ts).
   * Only set inside pollerMain.ts's container, where Scheduler uses it to shard devices across
   * poller processes instead of unconditionally owning every device locally. */
  leaseCoordinator?: LeaseCoordinator;
  repos: {
    device: DeviceRepo;
    group: GroupRepo;
    check: CheckRepo;
    status: StatusRepo;
    metric: MetricRepo;
    alert: AlertRepo;
    user: UserRepo;
    session: SessionRepo;
    settings: SettingsRepo;
    audit: AuditRepo;
    maintenance: MaintenanceRepo;
    notificationPrefs: NotificationPrefsRepo;
    notificationLog: NotificationLogRepo;
    history: HistoryRepo;
    topology: TopologyRepo;
    tenant: TenantRepo;
    alertNote: AlertNoteRepo;
    apiKey: ApiKeyRepo;
    discoverySchedule: DiscoveryScheduleRepo;
    onCallSchedule: OnCallScheduleRepo;
  };
}

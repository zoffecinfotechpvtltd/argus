// Repository interfaces. Adapters (sqlite/postgres) implement these; domain/application depend only on these types.
import type {
  Alert,
  AlertNote,
  AlertStatus,
  ApiKey,
  AuditLogEntry,
  Check,
  Device,
  DeviceGroup,
  DeviceStatus,
  DiscoverySchedule,
  MaintenanceWindow,
  Metric,
  NotificationLogEntry,
  NotificationPrefs,
  OnCallSchedule,
  Session,
  Tenant,
  User,
} from "@domain/entities";

export interface DeviceWithChecks {
  device: Device;
  checks: Check[];
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface DeviceFilter {
  groupId?: string;
  type?: string;
  search?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

export interface DeviceWithStatus extends Device {
  state: string | null;
  since: string | null;
  lastLatencyMs: number | null;
}

export interface DeviceRepo {
  create(device: Device): Promise<Device>;
  update(tenantId: string, id: string, patch: Partial<Device>): Promise<Device | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  findById(tenantId: string, id: string): Promise<Device | null>;
  findByIp(tenantId: string, ip: string): Promise<Device | null>;
  /** Every device that names `uplinkDeviceId` as its uplink — used by the alert engine to re-notify
   * downstream devices once the shared uplink itself recovers. */
  findByUplink(tenantId: string, uplinkDeviceId: string): Promise<Device[]>;
  list(tenantId: string, filter?: DeviceFilter): Promise<Page<Device>>;
  /** Devices joined with their current status in one SQL query — no per-device N+1 lookups. */
  listWithStatus(tenantId: string, filter?: DeviceFilter): Promise<Page<DeviceWithStatus>>;
  listAllEnabled(): Promise<Device[]>; // cross-tenant, used by scheduler at boot
  /** Atomically inserts every device with its default checks — used by bulk discovery import. */
  createBatchWithChecks(items: DeviceWithChecks[]): Promise<Device[]>;
}

export interface GroupRepo {
  create(group: DeviceGroup): Promise<DeviceGroup>;
  update(tenantId: string, id: string, patch: Partial<DeviceGroup>): Promise<DeviceGroup | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  findById(tenantId: string, id: string): Promise<DeviceGroup | null>;
  list(tenantId: string): Promise<DeviceGroup[]>;
}

export interface CheckRepo {
  create(check: Check): Promise<Check>;
  update(tenantId: string, id: string, patch: Partial<Check>): Promise<Check | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  findById(tenantId: string, id: string): Promise<Check | null>;
  listByDevice(tenantId: string, deviceId: string): Promise<Check[]>;
  listAllEnabled(): Promise<Check[]>;
}

export interface StatusRepo {
  upsert(status: DeviceStatus): Promise<void>;
  findByDeviceId(tenantId: string, deviceId: string): Promise<DeviceStatus | null>;
  listByTenant(tenantId: string): Promise<DeviceStatus[]>;
  summary(tenantId: string): Promise<Record<string, number>>;
}

export interface MetricQuery {
  deviceId: string;
  name?: string;
  from: string;
  to: string;
}

export interface MetricRepo {
  insertBatch(metrics: Metric[]): Promise<void>;
  queryRaw(tenantId: string, q: MetricQuery): Promise<Metric[]>;
  queryHourly(tenantId: string, q: MetricQuery): Promise<Metric[]>;
  rollupHour(tenantId: string, hourIso: string): Promise<number>;
  deleteRawOlderThan(cutoffIso: string): Promise<number>;
  deleteRollupsOlderThan(cutoffIso: string): Promise<number>;
  /** M5 — 95th-percentile of raw metric values matching the query, the "typical peak" stat used
   * for billing-style bandwidth reporting (ignores brief spikes above it). Null if no rows match. */
  percentile95(tenantId: string, q: MetricQuery): Promise<number | null>;
}

export interface AlertFilter {
  status?: AlertStatus;
  severity?: string;
  deviceId?: string;
  groupId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AlertRepo {
  create(alert: Alert): Promise<Alert>;
  update(tenantId: string, id: string, patch: Partial<Alert>): Promise<Alert | null>;
  findById(tenantId: string, id: string): Promise<Alert | null>;
  /** Cross-tenant lookup by ID alone — used only for the HMAC-signed one-click ack link, where the token itself is the authorization. */
  findByIdAnyTenant(id: string): Promise<Alert | null>;
  findOpenByCondition(tenantId: string, deviceId: string, conditionKey: string): Promise<Alert | null>;
  list(tenantId: string, filter?: AlertFilter): Promise<Page<Alert>>;
  listOpenUnacked(): Promise<Alert[]>; // cross-tenant, escalation worker
  /** Aggregate SQL count of open alerts grouped by severity — for the dashboard summary strip. */
  countOpenBySeverity(tenantId: string): Promise<Record<string, number>>;
  /** Aggregate SQL count of alerts opened per day within a range, grouped by severity — for the reports heatmap. */
  countByDayAndSeverity(tenantId: string, fromIso: string, toIso: string): Promise<Array<{ day: string; severity: string; count: number }>>;
  /** Atomically advances escalationStep only if it still equals `expectedStep`, returning whether
   * this call won the race. AlertEngine's initial-notify path and EscalationWorker's independent
   * periodic tick both call processEscalationForAlert (application/escalation.ts) on the same open
   * alerts without any other coordination between them — a plain read-then-write of escalationStep
   * lets both callers see the same starting step and both notify for it. This conditional-UPDATE
   * (only the caller whose WHERE clause still matches actually updates a row) is the mutual
   * exclusion primitive that makes exactly one of them win. */
  claimEscalationStep(tenantId: string, id: string, expectedStep: number, newStep: number): Promise<boolean>;
}

export interface UserRepo {
  create(user: User): Promise<User>;
  update(tenantId: string, id: string, patch: Partial<User>): Promise<User | null>;
  findById(tenantId: string, id: string): Promise<User | null>;
  /** Cross-tenant lookup by id alone — used by the password-reset link (the token itself, not a
   * session, is the authorization; same reasoning as AlertRepo.findByIdAnyTenant). */
  findByIdAnyTenant(id: string): Promise<User | null>;
  findByEmail(tenantId: string, email: string): Promise<User | null>;
  /** Cross-tenant lookup by email alone — used only at login, where there's no session/tenant
   * context yet to scope by (the same reasoning as AlertRepo.findByIdAnyTenant, used for the
   * signed one-click ack link: the caller doesn't know the tenant in advance, the lookup itself
   * has to find it). Exe mode has exactly one tenant so this is equivalent to findByEmail there;
   * saas mode genuinely needs it since a login form has no workspace selector (yet — see
   * SAAS_GAPS.md). Assumes email is unique across tenants, which isn't enforced anywhere today —
   * a real product decision for later, not a bug introduced here. */
  findByEmailAnyTenant(email: string): Promise<User | null>;
  list(tenantId: string): Promise<User[]>;
  countAll(): Promise<number>; // used for first-run detection
}

export interface SessionRepo {
  create(session: Session): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  revoke(id: string): Promise<void>;
  listByUser(tenantId: string, userId: string): Promise<Session[]>;
}

export interface SettingsRepo {
  get(tenantId: string, key: string): Promise<string | null>;
  set(tenantId: string, key: string, value: string): Promise<void>;
  getAll(tenantId: string): Promise<Record<string, string>>;
}

export interface AuditRepo {
  record(entry: AuditLogEntry): Promise<void>;
  list(
    tenantId: string,
    filter?: { userId?: string; action?: string; entityType?: string; entityId?: string; from?: string; to?: string; limit?: number; offset?: number }
  ): Promise<Page<AuditLogEntry>>;
}

export interface MaintenanceRepo {
  create(w: MaintenanceWindow): Promise<MaintenanceWindow>;
  delete(tenantId: string, id: string): Promise<boolean>;
  listActive(tenantId: string, atIso: string): Promise<MaintenanceWindow[]>;
  list(tenantId: string): Promise<MaintenanceWindow[]>;
}

export interface NotificationPrefsRepo {
  get(tenantId: string, userId: string): Promise<NotificationPrefs | null>;
  upsert(prefs: NotificationPrefs): Promise<void>;
  /** Cross-tenant — every user (any tenant) with a non-null digestRecurrence, for the digest scheduler. */
  listWithDigest(): Promise<NotificationPrefs[]>;
}

export interface NotificationLogRepo {
  record(entry: NotificationLogEntry): Promise<void>;
  list(tenantId: string, limit?: number): Promise<NotificationLogEntry[]>;
  /** M4 incident timeline — every notification attempt for one alert, in order. */
  listByAlert(tenantId: string, alertId: string): Promise<NotificationLogEntry[]>;
}

export interface StateInterval {
  startedAt: string;
  endedAt: string | null;
}

export interface HistoryRepo {
  /** All intervals where `deviceId` was in `state`, overlapping [fromIso, toIso]. Used for SLA/availability reports. */
  listStateIntervals(tenantId: string, deviceId: string, state: string, fromIso: string, toIso: string): Promise<StateInterval[]>;
}

export interface TopologyPosition {
  /** A device id, or a synthetic map node id: "group:<groupId>" or "__core__". */
  nodeId: string;
  x: number;
  y: number;
}

export interface TopologyRepo {
  savePosition(tenantId: string, userId: string, nodeId: string, x: number, y: number): Promise<void>;
  listPositions(tenantId: string, userId: string): Promise<TopologyPosition[]>;
}

export interface TenantRepo {
  create(tenant: Tenant): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  update(id: string, patch: Partial<Tenant>): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
}

export interface AlertNoteRepo {
  create(note: AlertNote): Promise<AlertNote>;
  listByAlert(tenantId: string, alertId: string): Promise<AlertNote[]>;
}

export interface ApiKeyRepo {
  create(key: ApiKey): Promise<ApiKey>;
  revoke(tenantId: string, id: string): Promise<boolean>;
  list(tenantId: string): Promise<ApiKey[]>;
  /** Cross-tenant lookup by key prefix — the incoming key is opaque to the caller until looked up by its prefix, then verified by hash. */
  findByPrefix(prefix: string): Promise<ApiKey | null>;
  touchLastUsed(id: string, atIso: string): Promise<void>;
}

export interface OnCallScheduleRepo {
  create(schedule: OnCallSchedule): Promise<OnCallSchedule>;
  update(tenantId: string, id: string, patch: Partial<OnCallSchedule>): Promise<OnCallSchedule | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  findByGroup(tenantId: string, groupId: string): Promise<OnCallSchedule | null>;
  list(tenantId: string): Promise<OnCallSchedule[]>;
}

export interface DiscoveryScheduleRepo {
  create(schedule: DiscoverySchedule): Promise<DiscoverySchedule>;
  update(tenantId: string, id: string, patch: Partial<DiscoverySchedule>): Promise<DiscoverySchedule | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  list(tenantId: string): Promise<DiscoverySchedule[]>;
  /** Cross-tenant — the discovery-schedule runner ticks once for every tenant, not per-tenant. */
  listDue(atIso: string): Promise<DiscoverySchedule[]>;
}

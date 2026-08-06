// Pure domain types. NO imports from adapters/ or ports/ — this file must never touch I/O.

export type Role = "admin" | "operator" | "viewer";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: Role;
  forcePasswordReset: boolean;
  disabled: boolean;
  emailVerifiedAt: string | null;
  /** TOTP (RFC 6238) 2FA — null/false until the user completes enrollment. */
  totpSecret: string | null;
  totpEnabled: boolean;
  /** Per-account lockout, independent of the per-IP rate limiter in rateLimit.ts — see auth.ts login route. */
  failedLoginCount: number;
  lockedUntil: string | null;
  /** RBAC group-scoping (M7). null/absent (every user today) means unscoped — sees/acts on every
   * device regardless of group, the existing behavior for the whole app so far. A non-empty array
   * restricts the user to devices in those groups; enforced by `assertGroupAccess`
   * (src/api/middleware/auth.ts), currently wired into the single-device routes in
   * src/api/routes/devices.ts only — see the comment there before extending it further. */
  scopedGroupIds?: string[] | null;
  /** ISO timestamp once the first-login walkthrough has been completed or dismissed — null for
   * every existing account until then. Never reset automatically, so the tour only ever shows
   * once per account (see ui/src/components/onboarding/OnboardingTour.tsx). */
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Argus has exactly one tenant (DEFAULT_TENANT_ID, "local") — every repo method still takes a
 * tenantId for a uniform shape, but there's no signup/provisioning/plan-tier concept. `plan` is a
 * free-form label on the single row, not an enforced tier. */
export interface Tenant {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
}

export interface Session {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip?: string;
  userAgent?: string;
}

export interface DeviceGroup {
  id: string;
  tenantId: string;
  name: string;
  escalationChain: EscalationStep[];
  createdAt: string;
  updatedAt: string;
}

export interface EscalationStep {
  /** Fixed target. Mutually exclusive with `onCall` in practice (see resolveEscalationTarget) —
   * both stay optional rather than a discriminated union so existing chain rows (userId always
   * set, onCall never present) keep parsing unchanged. */
  userId?: string;
  /** If true, resolve the notify target from the group's OnCallSchedule (M4) at the moment this
   * step fires, instead of a fixed userId — "whoever's on call" rather than "always this person". */
  onCall?: boolean;
  afterMinutes: number;
}

export interface OnCallSchedule {
  id: string;
  tenantId: string;
  groupId: string;
  /** Rotation order — userIds[0] holds the first shift starting at rotationStartAt, then cycles. */
  userIds: string[];
  shiftLengthHours: number;
  rotationStartAt: string;
  createdAt: string;
  updatedAt: string;
}

export type DeviceType =
  | "camera"
  | "firewall"
  | "switch"
  | "router"
  | "server"
  | "workstation"
  | "printer"
  | "access_point"
  | "nas"
  | "iot"
  | "unknown";

export interface Device {
  id: string;
  tenantId: string;
  name: string;
  ip: string;
  mac: string | null;
  vendor: string | null;
  type: DeviceType;
  location: string | null;
  groupId: string | null;
  responsibleUserId: string | null;
  intervalSec: number;
  enabled: boolean;
  snmpCredsEnc: string | null;
  /** Free-form asset/site/owner labels — filterable in Inventory, not interpreted by any logic. */
  tags: string[];
  /** Optional "this device's uplink" pointer (e.g. the core switch/router it sits behind) — used
   * only by the alert engine to suppress a downstream device's paging while its uplink is down
   * (the alert itself still opens and is visible in the UI; only notification is held back). */
  uplinkDeviceId: string | null;
  /** When true, a DOWN transition on this device skips the storm buffer and per-hour rate limit
   * entirely — it pages immediately instead of waiting to see if it's part of a wider outage.
   * For assets whose own downtime is always actionable regardless of what else is happening
   * (cameras, firewalls), not for "this device is part of a group that might storm together". */
  criticalAsset: boolean;
  /** Vendor identity facts (FortiGate model, firmware build, serial, HA role) — populated by the
   * matching vendor-API checker via CheckResult.deviceFacts on its normal poll cadence, not
   * admin-entered. Null until the first successful poll, or always null if apiVendor is unset. */
  model: string | null;
  firmwareVersion: string | null;
  serialNumber: string | null;
  haRole: "primary" | "secondary" | null;
  /** Which vendor REST API apiCredsEnc's decrypted+parsed JSON should be interpreted as, and which
   * check kind buildDefaultChecks attaches. Null = no vendor API configured for this device. */
  apiVendor: "fortigate" | null;
  apiCredsEnc: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CheckKind = "icmp" | "tcp" | "http" | "snmp" | "fortigate_api";

export interface CheckConfig {
  // tcp/http
  port?: number;
  path?: string;
  expectedStatus?: number[];
  expectBody?: string;
  timeoutMs?: number;
  allowSelfSigned?: boolean;
  tls?: boolean;
  /** SSRF guard override: permits an HTTP check to target 127.0.0.0/8 (e.g. monitoring the local host itself). Link-local/metadata (169.254.0.0/16) is never allowed. */
  allowLocalhost?: boolean;
  // snmp
  community?: string;
  version?: "2c" | "3";
  interfaces?: number[];
}

export interface CheckThresholds {
  latencyMs?: number;
  lossPct?: number;
}

export interface Check {
  id: string;
  tenantId: string;
  deviceId: string;
  kind: CheckKind;
  config: CheckConfig;
  thresholds: CheckThresholds;
  enabled: boolean;
  createdAt: string;
}

export type DeviceState = "up" | "degraded" | "down" | "flapping" | "maintenance";

export interface TransitionEvent {
  at: string;
  from: DeviceState;
  to: DeviceState;
}

export interface DeviceStatus {
  deviceId: string;
  tenantId: string;
  state: DeviceState;
  since: string;
  lastSeen: string | null;
  lastLatencyMs: number | null;
  consecutiveFails: number;
  consecutiveOk: number;
  transitionLog: TransitionEvent[];
}

export interface Metric {
  id?: number;
  tenantId: string;
  deviceId: string;
  checkId: string | null;
  ts: string;
  name: string;
  value: number;
}

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  tenantId: string;
  deviceId: string;
  conditionKey: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: string | null;
  openedAt: string;
  lastSeenAt: string;
  ackedBy: string | null;
  ackedAt: string | null;
  resolvedAt: string | null;
  escalationStep: number;
}

export type NotificationChannel = "email" | "webhook";

export interface NotificationLogEntry {
  id?: number;
  tenantId: string;
  alertId: string | null;
  channel: NotificationChannel;
  target: string;
  status: "sent" | "failed";
  error: string | null;
  createdAt: string;
}

export interface MaintenanceWindow {
  id: string;
  tenantId: string;
  deviceId: string | null;
  groupId: string | null;
  startsAt: string;
  endsAt: string;
  recurrence: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id?: number;
  tenantId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export type DigestRecurrence = "daily" | "weekly";

export interface NotificationPrefs {
  userId: string;
  tenantId: string;
  channels: NotificationChannel[];
  severityFloor: AlertSeverity;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  webhookUrl: string | null;
  /** Opt-in personal summary email (SLA + open-alerts digest), independent of real-time channels above. */
  digestRecurrence: DigestRecurrence | null;
}

/** One free-text investigation comment on an alert — append-only, like the audit log. */
export interface AlertNote {
  id: string;
  tenantId: string;
  alertId: string;
  userId: string | null;
  body: string;
  createdAt: string;
}

/** Deliberately narrow, read-only-by-default external API access — reintroduced after
 * `migrations/0007_remove_api_keys.sql` removed the old SaaS-mode key surface entirely. Every route
 * that accepts a key enforces GET-only regardless of `scopes`, so this can't become a write surface
 * by mistake later without a separate, deliberate change to the routes themselves. */
export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface DiscoverySchedule {
  id: string;
  tenantId: string;
  cidr: string;
  snmpCredsEnc: string | null;
  recurrence: DigestRecurrence;
  targetGroupId: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdBy: string | null;
  createdAt: string;
}

export const DEFAULT_TENANT_ID = "local";

export interface DiscoveredDevice {
  ip: string;
  mac: string | null;
  vendor: string | null;
  hostname: string | null;
  rttMs: number | null;
  openPorts: number[];
  snmpSysDescr: string | null;
  snmpSysName: string | null;
  guessedType: DeviceType;
  confidence: number;
}

export interface DiscoveryProgress {
  scanned: number;
  total: number;
  found: DiscoveredDevice[];
}

/** M6: which devices/groups a tenant has opted into showing, and under what title, on its public
 * (unauthenticated) status page. Deliberately NOT a new table — this is a single small JSON blob
 * per tenant, so it's stored via the existing tenant-scoped key/value `SettingsRepo` the same way
 * SMTP/webhook/syslog config already are (see STATUS_PAGE_SETTINGS_KEY in
 * src/application/statusPage.ts), rather than adding a bespoke table + repo pair for one row.
 * Visibility is an explicit allowlist (deviceIds/groupIds) rather than a `public` boolean bolted
 * onto Device/DeviceGroup: a device is never shown publicly by default, and this avoids a schema
 * change (+ Postgres migration) to two of the most frequently touched tables for a feature most
 * tenants will never turn on. Only state (up/down/degraded/...) is ever exposed for a listed
 * device/group — no IP, no config, no credentials — that redaction happens in
 * generatePublicStatusPage (src/application/statusPage.ts), not here. */
export interface StatusPageConfig {
  enabled: boolean;
  title: string;
  deviceIds: string[];
  groupIds: string[];
}

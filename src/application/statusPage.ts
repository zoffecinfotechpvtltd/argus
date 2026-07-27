import type { AppContainer } from "@ports/context";
import type { StatusPageConfig } from "@domain/entities";

/** Same key/value SettingsRepo SMTP/webhook/syslog/general config already use (see
 * StatusPageConfig's own doc comment in src/domain/entities.ts for why this isn't a table). */
export const STATUS_PAGE_SETTINGS_KEY = "statusPage.config";

export const DEFAULT_STATUS_PAGE_CONFIG: StatusPageConfig = { enabled: false, title: "", deviceIds: [], groupIds: [] };

export async function getStatusPageConfig(app: AppContainer, tenantId: string): Promise<StatusPageConfig> {
  const raw = await app.repos.settings.get(tenantId, STATUS_PAGE_SETTINGS_KEY);
  return raw ? { ...DEFAULT_STATUS_PAGE_CONFIG, ...(JSON.parse(raw) as Partial<StatusPageConfig>) } : DEFAULT_STATUS_PAGE_CONFIG;
}

export async function setStatusPageConfig(app: AppContainer, tenantId: string, config: StatusPageConfig): Promise<void> {
  await app.repos.settings.set(tenantId, STATUS_PAGE_SETTINGS_KEY, JSON.stringify(config));
}

export interface PublicDeviceStatus {
  id: string;
  name: string;
  state: string;
}

export interface PublicGroupStatus {
  id: string;
  name: string;
  devices: PublicDeviceStatus[];
}

export interface PublicIncident {
  title: string;
  severity: string;
  openedAt: string;
  resolvedAt: string | null;
}

export type OverallState = "operational" | "degraded" | "outage";

export interface PublicStatusPage {
  tenantName: string;
  title: string;
  overallState: OverallState;
  groups: PublicGroupStatus[];
  ungrouped: PublicDeviceStatus[];
  recentIncidents: PublicIncident[];
}

// Worse state -> higher rank. "maintenance" reads as intentional/expected, not a problem, so it
// ranks alongside "up" rather than dragging the page into "degraded" for a planned window.
const STATE_RANK: Record<string, number> = { up: 0, maintenance: 0, degraded: 1, flapping: 1, down: 2 };

const RECENT_INCIDENTS_LIMIT = 5;

/** Builds the public, unauthenticated payload for a tenant's status page — or null if the tenant
 * doesn't exist, hasn't enabled the page, or hasn't opted any device/group into it yet (all three
 * are treated as "no page" rather than "empty page", so the route can 404 uniformly). Every field
 * on the result is safe to hand to an anonymous caller: device state only, never IP/config/creds
 * (see StatusPageConfig's doc comment for why visibility is an explicit allowlist). */
export async function generatePublicStatusPage(app: AppContainer, tenantId: string): Promise<PublicStatusPage | null> {
  const [tenant, config] = await Promise.all([app.repos.tenant.findById(tenantId), getStatusPageConfig(app, tenantId)]);
  if (!tenant || !config.enabled) return null;
  if (config.deviceIds.length === 0 && config.groupIds.length === 0) return null;

  const [devicePage, groupList, alertPage] = await Promise.all([
    app.repos.device.listWithStatus(tenantId, { limit: 10_000 }),
    app.repos.group.list(tenantId),
    app.repos.alert.list(tenantId, { limit: 20 }),
  ]);

  const groupIdSet = new Set(config.groupIds);
  const deviceIdSet = new Set(config.deviceIds);
  const publicDevices = devicePage.items.filter((d) => deviceIdSet.has(d.id) || (d.groupId && groupIdSet.has(d.groupId)));
  const publicDeviceIds = new Set(publicDevices.map((d) => d.id));
  if (publicDevices.length === 0) return null;

  const groups: PublicGroupStatus[] = groupList
    .filter((g) => groupIdSet.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      devices: publicDevices.filter((d) => d.groupId === g.id).map((d) => ({ id: d.id, name: d.name, state: d.state ?? "up" })),
    }));

  const ungrouped: PublicDeviceStatus[] = publicDevices
    .filter((d) => !d.groupId || !groupIdSet.has(d.groupId))
    .map((d) => ({ id: d.id, name: d.name, state: d.state ?? "up" }));

  const worstRank = publicDevices.reduce((rank, d) => Math.max(rank, STATE_RANK[d.state ?? "up"] ?? 0), 0);
  const overallState: OverallState = worstRank >= 2 ? "outage" : worstRank === 1 ? "degraded" : "operational";

  const recentIncidents: PublicIncident[] = alertPage.items
    .filter((a) => publicDeviceIds.has(a.deviceId))
    .slice(0, RECENT_INCIDENTS_LIMIT)
    .map((a) => ({ title: a.title, severity: a.severity, openedAt: a.openedAt, resolvedAt: a.resolvedAt }));

  return {
    tenantName: tenant.name,
    title: config.title || tenant.name,
    overallState,
    groups,
    ungrouped,
    recentIncidents,
  };
}

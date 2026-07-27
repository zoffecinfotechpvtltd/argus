import type { AppContainer } from "@ports/context";
import { availabilityPct, totalDownMs } from "@domain/availability";

export interface SlaReportRow {
  deviceId: string;
  deviceName: string;
  availabilityPct: number;
  downMs: number;
}

export async function generateSlaReport(
  app: AppContainer,
  tenantId: string,
  opts: { groupId?: string; fromIso: string; toIso: string }
): Promise<SlaReportRow[]> {
  const page = await app.repos.device.list(tenantId, { groupId: opts.groupId, limit: 10_000 });
  const periodMs = new Date(opts.toIso).getTime() - new Date(opts.fromIso).getTime();
  const nowIso = app.clock.nowIso();

  const rows: SlaReportRow[] = [];
  for (const device of page.items) {
    const intervals = await app.repos.history.listStateIntervals(tenantId, device.id, "down", opts.fromIso, opts.toIso);
    const downMs = totalDownMs(intervals, opts.fromIso, opts.toIso, nowIso);
    rows.push({ deviceId: device.id, deviceName: device.name, availabilityPct: availabilityPct(periodMs, downMs), downMs });
  }
  return rows;
}

export function slaReportToCsv(rows: SlaReportRow[]): string {
  const header = "Device,Availability %,Downtime (min)";
  const lines = rows.map((r) => `${csvEscape(r.deviceName)},${r.availabilityPct},${Math.round(r.downMs / 60_000)}`);
  return [header, ...lines].join("\n");
}

export interface AlertsByDayRow {
  day: string;
  severity: string;
  count: number;
}

export function alertsSummaryToCsv(rows: AlertsByDayRow[]): string {
  const header = "Day,Severity,Count";
  const lines = rows.map((r) => `${csvEscape(r.day)},${csvEscape(r.severity)},${r.count}`);
  return [header, ...lines].join("\n");
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface InventoryReportRow {
  name: string;
  ip: string;
  type: string;
  group: string;
  location: string;
  tags: string;
  state: string;
  enabled: boolean;
}

/** Asset/inventory export — device list with type/group/location/tags/status, for handing to
 * an asset-management or compliance process outside the app (the CSV counterpart of the
 * Inventory page's own client-side export, but computed server-side so it can also back the
 * scheduled/emailed report path). */
export async function generateInventoryReport(app: AppContainer, tenantId: string): Promise<InventoryReportRow[]> {
  const [page, groups] = await Promise.all([
    app.repos.device.listWithStatus(tenantId, { limit: 10_000 }),
    app.repos.group.list(tenantId),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return page.items.map((d) => ({
    name: d.name,
    ip: d.ip,
    type: d.type,
    group: d.groupId ? (groupName.get(d.groupId) ?? "") : "",
    location: d.location ?? "",
    tags: d.tags.join(";"),
    state: d.state ?? "unknown",
    enabled: d.enabled,
  }));
}

export function inventoryReportToCsv(rows: InventoryReportRow[]): string {
  const header = "Name,IP,Type,Group,Location,Tags,State,Enabled";
  const lines = rows.map((r) =>
    [r.name, r.ip, r.type, r.group, r.location, r.tags, r.state, r.enabled ? "true" : "false"].map(csvEscape).join(",")
  );
  return [header, ...lines].join("\n");
}

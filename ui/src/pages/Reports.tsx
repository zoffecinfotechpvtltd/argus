import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileDown, Printer } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import type { DeviceGroup } from "../api/types";
import { SEVERITY_HEX } from "../api/alertTypes";
import { DEVICE_STATE_HEX } from "../lib/statusTokens";
import { Button, Card, EmptyState, Input, Select, Skeleton, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";

interface ScheduledReportConfig {
  enabled: boolean;
  recipients: string[];
  recurrence: "daily" | "weekly";
  lastSentAt: string | null;
}

interface SlaRow {
  deviceId: string;
  deviceName: string;
  availabilityPct: number;
  downMs: number;
}

interface AlertDayRow {
  day: string;
  severity: string;
  count: number;
}

// Status palette (fixed, reserved meaning — never reused as a categorical series color). Sourced
// from statusTokens.ts so "good"/"critical" here mean the same hue as everywhere else.
const STATUS = {
  good: DEVICE_STATE_HEX.up,
  critical: SEVERITY_HEX.critical,
};

// A device meeting this bar is drawn in the "good" status color; below it, "critical".
// 99.9% is the conventional monitoring-industry SLA target ("three nines").
const SLA_TARGET_PCT = 99.9;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function SlaTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SlaRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  const meetsTarget = row.availabilityPct >= SLA_TARGET_PCT;
  return (
    <div className="rounded-md border border-border bg-bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-text-primary">{row.deviceName}</p>
      <p className="mt-1 text-text-secondary">
        {row.availabilityPct}% available ·{" "}
        <span style={{ color: meetsTarget ? STATUS.good : STATUS.critical }}>
          {meetsTarget ? "meets" : "below"} {SLA_TARGET_PCT}% target
        </span>
      </p>
      <p className="text-text-secondary">{Math.round(row.downMs / 60000)} min downtime</p>
    </div>
  );
}

export function Reports() {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [periodDays, setPeriodDays] = useState(1);
  const [slaRows, setSlaRows] = useState<SlaRow[] | null>(null);
  const [alertRows, setAlertRows] = useState<AlertDayRow[] | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const [schedule, setSchedule] = useState<ScheduledReportConfig | null>(null);
  const [recipientsText, setRecipientsText] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    api.get<DeviceGroup[]>("/groups").then(setGroups).catch(() => {});
    if (isAdmin) {
      api
        .get<ScheduledReportConfig>("/reports/schedule")
        .then((s) => {
          setSchedule(s);
          setRecipientsText(s.recipients.join(", "));
        })
        .catch(() => {});
    }
  }, [isAdmin]);

  async function saveSchedule() {
    if (!schedule) return;
    setSavingSchedule(true);
    try {
      const recipients = recipientsText.split(",").map((r) => r.trim()).filter(Boolean);
      await api.put("/reports/schedule", { enabled: schedule.enabled, recipients, recurrence: schedule.recurrence });
      toast.success("Scheduled report saved.");
    } catch {
      toast.error("Failed to save scheduled report settings.");
    } finally {
      setSavingSchedule(false);
    }
  }

  function exportInventoryCsv() {
    window.open("/api/reports/inventory?format=csv", "_blank");
  }

  async function loadSla() {
    const params = new URLSearchParams({ from: isoDaysAgo(periodDays), to: new Date().toISOString() });
    if (groupId) params.set("groupId", groupId);
    setSlaRows(await api.get<SlaRow[]>(`/reports/sla?${params.toString()}`));
  }

  async function loadAlertSummary() {
    const params = new URLSearchParams({ from: isoDaysAgo(periodDays), to: new Date().toISOString() });
    setAlertRows(await api.get<AlertDayRow[]>(`/reports/alerts-summary?${params.toString()}`));
  }

  useEffect(() => {
    loadSla().catch(() => {});
    loadAlertSummary().catch(() => {});
  }, [groupId, periodDays]);

  function exportSlaCsv() {
    const params = new URLSearchParams({ from: isoDaysAgo(periodDays), to: new Date().toISOString(), format: "csv" });
    if (groupId) params.set("groupId", groupId);
    window.open(`/api/reports/sla?${params.toString()}`, "_blank");
  }

  function exportAlertsCsv() {
    const params = new URLSearchParams({ from: isoDaysAgo(periodDays), to: new Date().toISOString(), format: "csv" });
    window.open(`/api/reports/alerts-summary?${params.toString()}`, "_blank");
  }

  const alertRowsSafe = alertRows ?? [];
  const days = Array.from(new Set(alertRowsSafe.map((r) => r.day))).sort();
  const trendData = days.map((day) => ({
    day,
    critical: alertRowsSafe.find((r) => r.day === day && r.severity === "critical")?.count ?? 0,
    warning: alertRowsSafe.find((r) => r.day === day && r.severity === "warning")?.count ?? 0,
    info: alertRowsSafe.find((r) => r.day === day && r.severity === "info")?.count ?? 0,
  }));
  const severities = ["critical", "warning", "info"] as const;
  const maxCountBySeverity: Record<string, number> = {};
  for (const s of severities) {
    maxCountBySeverity[s] = Math.max(1, ...alertRowsSafe.filter((r) => r.severity === s).map((r) => r.count));
  }
  // Downtime minutes, not raw availability %, is the bar's magnitude — availability clusters
  // near 100% for a healthy fleet, which compresses every bar to the same visual height on a
  // 0-100 scale. Minutes-down has a natural zero and lets the one problem device actually stand out.
  const slaChartData = (slaRows ?? []).map((r) => ({ ...r, downtimeMin: Math.round(r.downMs / 60000) }));

  return (
    <Layout title="Reports" subtitle="SLA, alert trends, and asset exports">
      <div className="mx-auto max-w-5xl space-y-6 print:max-w-none">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </Select>
          <Button variant="secondary" size="sm" onClick={exportSlaCsv}>
            <FileDown size={14} aria-hidden="true" /> Export SLA CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()} title="Opens your browser's print dialog — choose 'Save as PDF' as the destination">
            <Printer size={14} aria-hidden="true" /> Print / Save as PDF
          </Button>
        </div>

        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tighter text-text-primary">SLA / Availability — downtime by device</h2>
            <div className="flex items-center gap-4 text-xs text-text-secondary">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS.good }} />
                meets {SLA_TARGET_PCT}% target
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS.critical }} />
                below target
              </span>
            </div>
          </div>
          {slaRows === null ? (
            <div className="flex h-64 items-center justify-center">
              <Skeleton className="h-48 w-full" />
            </div>
          ) : slaChartData.length === 0 ? (
            <EmptyState icon={FileDown} title="No devices in range" description="Widen the date range or clear the group filter." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={slaChartData} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="rgb(var(--chart-grid))" />
                  <XAxis dataKey="deviceName" tick={{ fontSize: 10, fill: "#A1A1AA" }} axisLine={{ stroke: "#D4D4D8" }} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#A1A1AA" }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: "minutes down", angle: -90, position: "insideLeft", fill: "#A1A1AA", fontSize: 10 }}
                  />
                  <Tooltip content={<SlaTooltip />} cursor={{ fill: "rgba(161,161,170,0.12)" }} />
                  <Bar dataKey="downtimeMin" radius={[4, 4, 0, 0]} maxBarSize={24}>
                    {slaChartData.map((r) => (
                      <Cell key={r.deviceId} fill={r.availabilityPct >= SLA_TARGET_PCT ? STATUS.good : STATUS.critical} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-text-secondary">
                    <tr>
                      <th className="py-1">Device</th>
                      <th className="py-1">Availability</th>
                      <th className="py-1">Downtime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(slaRows ?? []).map((r) => (
                      <tr key={r.deviceId} className="border-b border-border/60 last:border-b-0">
                        <td className="py-1.5 text-text-primary">{r.deviceName}</td>
                        <td className="py-1.5">
                          <span style={{ color: r.availabilityPct >= SLA_TARGET_PCT ? STATUS.good : STATUS.critical }}>{r.availabilityPct}%</span>
                        </td>
                        <td className="py-1.5 text-text-secondary">{Math.round(r.downMs / 60000)} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tighter text-text-primary">Alert summary (by day / severity)</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 text-xs text-text-secondary">
                {severities.map((s) => (
                  <span key={s} className="flex items-center gap-1.5 capitalize">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SEVERITY_HEX[s] }} />
                    {s}
                  </span>
                ))}
              </div>
              <Button variant="secondary" size="sm" onClick={exportAlertsCsv} className="print:hidden">
                <FileDown size={13} aria-hidden="true" /> CSV
              </Button>
            </div>
          </div>
          {alertRows === null ? (
            <div className="flex h-40 items-center justify-center">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : days.length === 0 ? (
            <EmptyState icon={FileDown} title="No alerts in range" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#A1A1AA" }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: "#A1A1AA" }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="critical" stackId="sev" stroke={SEVERITY_HEX.critical} fill={SEVERITY_HEX.critical} fillOpacity={0.55} isAnimationActive={false} />
                  <Area type="monotone" dataKey="warning" stackId="sev" stroke={SEVERITY_HEX.warning} fill={SEVERITY_HEX.warning} fillOpacity={0.5} isAnimationActive={false} />
                  <Area type="monotone" dataKey="info" stackId="sev" stroke={SEVERITY_HEX.info} fill={SEVERITY_HEX.info} fillOpacity={0.45} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-4 overflow-x-auto">
                <table className="text-xs">
                <thead>
                  <tr>
                    <th className="pr-2 text-left text-text-secondary">Day</th>
                    {severities.map((s) => (
                      <th key={s} className="px-2 capitalize text-text-secondary">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day}>
                      <td className="pr-2 text-text-secondary">{day}</td>
                      {severities.map((s) => {
                        const count = alertRows.find((r) => r.day === day && r.severity === s)?.count ?? 0;
                        // Magnitude is opacity WITHIN this severity's own hue — never a shared
                        // "redder = more" ramp across severities, which would make a high-count
                        // info day look as alarming as a low-count critical one.
                        const intensity = count === 0 ? 0 : 0.25 + (count / maxCountBySeverity[s]!) * 0.65;
                        return (
                          <td key={s} className="p-1">
                            <div
                              title={`${count} ${s} alert${count === 1 ? "" : "s"} on ${day}`}
                              className="flex h-8 w-14 items-center justify-center rounded text-text-primary"
                              style={{
                                backgroundColor: count === 0 ? "rgba(161,161,170,0.12)" : `rgba(${hexToRgb(SEVERITY_HEX[s]!)},${intensity})`,
                              }}
                            >
                              {count || ""}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </Card>

        <Card className="p-6 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tighter text-text-primary">Inventory / asset report</h2>
              <p className="text-xs text-text-secondary">Full device list with type, group, location, tags, and current status.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={exportInventoryCsv}>
              <FileDown size={13} aria-hidden="true" /> Export CSV
            </Button>
          </div>
        </Card>

        {isAdmin && schedule && (
          <Card className="p-6 print:hidden">
            <h2 className="mb-1 font-display text-lg font-semibold tracking-tighter text-text-primary">Scheduled email report</h2>
            <p className="mb-4 text-xs text-text-secondary">
              Sends the SLA + open-alerts summary above to a fixed recipient list on a recurring schedule, via the SMTP settings in
              Notifications.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
                  className="cursor-pointer accent-accent"
                />
                Enabled
              </label>
              <Select value={schedule.recurrence} onChange={(e) => setSchedule({ ...schedule, recurrence: e.target.value as "daily" | "weekly" })}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </Select>
              <Input
                className="min-w-[240px] flex-1"
                placeholder="recipient1@company.com, recipient2@company.com"
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
              />
              <Button size="sm" onClick={saveSchedule} disabled={savingSchedule}>
                {savingSchedule ? "Saving…" : "Save"}
              </Button>
            </div>
            {schedule.lastSentAt && (
              <p className="mt-2 text-xs text-text-secondary">Last sent {new Date(schedule.lastSentAt).toLocaleString()}.</p>
            )}
          </Card>
        )}
      </div>
    </Layout>
  );
}

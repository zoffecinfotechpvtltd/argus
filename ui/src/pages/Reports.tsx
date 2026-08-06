import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileDown } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import { SEVERITY_HEX } from "../api/alertTypes";
import { Button, Card, EmptyState, Input, Select, Skeleton, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";

interface ScheduledReportConfig {
  enabled: boolean;
  recipients: string[];
  recurrence: "daily" | "weekly";
  lastSentAt: string | null;
}

interface AlertDayRow {
  day: string;
  severity: string;
  count: number;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function Reports() {
  const [periodDays, setPeriodDays] = useState(1);
  const [alertRows, setAlertRows] = useState<AlertDayRow[] | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const [schedule, setSchedule] = useState<ScheduledReportConfig | null>(null);
  const [recipientsText, setRecipientsText] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
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

  async function loadAlertSummary() {
    const params = new URLSearchParams({ from: isoDaysAgo(periodDays), to: new Date().toISOString() });
    setAlertRows(await api.get<AlertDayRow[]>(`/reports/alerts-summary?${params.toString()}`));
  }

  useEffect(() => {
    loadAlertSummary().catch(() => {});
  }, [periodDays]);

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
  return (
    <Layout title="Reports" subtitle="Alert trends, asset exports, and scheduled digests">
      <div className="mx-auto max-w-5xl space-y-6 print:max-w-none">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <Select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </Select>
        </div>

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
              {/* A line/area chart's whole job is showing change across points — with the "Last 24
                  hours" range there is exactly one day, so this used to render one isolated dot
                  floating with no visible axis (nothing to draw a line between, and no second point
                  to give the axis a real span to scale against). The day-by-day table below already
                  states the same one day's numbers plainly, so below 2 days the chart is skipped
                  rather than rendering something that looks broken because the data genuinely can't
                  support a trend line yet. */}
              {days.length > 1 && (
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
              )}
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
              Sends the SLA report (see the SLA page) plus an open-alerts summary to a fixed recipient list on a recurring schedule, via the SMTP
              settings in Notifications.
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

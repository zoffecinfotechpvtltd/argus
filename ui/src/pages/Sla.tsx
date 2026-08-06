import { useEffect, useState } from "react";
import { BarChart, Bar, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileDown, Printer } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import type { DeviceGroup } from "../api/types";
import { SEVERITY_HEX } from "../api/alertTypes";
import { DEVICE_STATE_HEX } from "../lib/statusTokens";
import { Button, EmptyState, Select, Skeleton } from "../components/ui";
import { BentoCard } from "../components/charts/BentoCard";

interface SlaRow {
  deviceId: string;
  deviceName: string;
  availabilityPct: number;
  downMs: number;
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

function SlaTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SlaRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  const meetsTarget = row.availabilityPct >= SLA_TARGET_PCT;
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs shadow-md">
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

/** SLA/availability lives on its own page, split out of the old combined Reports page — SLA is a
 * commitment you track against continuously (its own filters, its own export, checked far more
 * often than an asset export or a scheduled digest), not one card among several general-purpose
 * reports. The alert-trend/asset-export/scheduled-email content that used to sit alongside it
 * stays on Reports; this page only ever shows availability. */
export function Sla() {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [periodDays, setPeriodDays] = useState(1);
  const [slaRows, setSlaRows] = useState<SlaRow[] | null>(null);

  useEffect(() => {
    api.get<DeviceGroup[]>("/groups").then(setGroups).catch(() => {});
  }, []);

  async function loadSla() {
    const params = new URLSearchParams({ from: isoDaysAgo(periodDays), to: new Date().toISOString() });
    if (groupId) params.set("groupId", groupId);
    setSlaRows(await api.get<SlaRow[]>(`/reports/sla?${params.toString()}`));
  }

  useEffect(() => {
    loadSla().catch(() => {});
  }, [groupId, periodDays]);

  function exportSlaCsv() {
    const params = new URLSearchParams({ from: isoDaysAgo(periodDays), to: new Date().toISOString(), format: "csv" });
    if (groupId) params.set("groupId", groupId);
    window.open(`/api/reports/sla?${params.toString()}`, "_blank");
  }

  // Downtime minutes, not raw availability %, is the bar's magnitude — availability clusters near
  // 100% for a healthy fleet, which compresses every bar to the same visual height on a 0-100
  // scale. Minutes-down has a natural zero and lets the one problem device actually stand out.
  const slaChartData = (slaRows ?? []).map((r) => ({ ...r, downtimeMin: Math.round(r.downMs / 60000) }));
  const metTarget = (slaRows ?? []).filter((r) => r.availabilityPct >= SLA_TARGET_PCT).length;
  const totalDowntimeMin = slaChartData.reduce((sum, r) => sum + r.downtimeMin, 0);
  const worst = slaChartData.length > 0 ? [...slaChartData].sort((a, b) => a.availabilityPct - b.availabilityPct)[0] : null;

  return (
    <Layout title="SLA" subtitle="Availability against target, by device">
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
            <FileDown size={14} aria-hidden="true" /> Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()} title="Opens your browser's print dialog — choose 'Save as PDF' as the destination">
            <Printer size={14} aria-hidden="true" /> Print / Save as PDF
          </Button>
        </div>

        {slaRows !== null && slaChartData.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
            <BentoCard className="p-4">
              <div className="text-2xs uppercase tracking-wide text-text-secondary">Meeting target</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tightest text-text-primary">
                {metTarget}
                <span className="text-base font-medium text-text-muted"> / {slaChartData.length}</span>
              </div>
            </BentoCard>
            <BentoCard className="p-4">
              <div className="text-2xs uppercase tracking-wide text-text-secondary">Total downtime</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tightest text-text-primary">{totalDowntimeMin} min</div>
            </BentoCard>
            <BentoCard className="p-4">
              <div className="text-2xs uppercase tracking-wide text-text-secondary">Worst performer</div>
              <div className="mt-1 truncate text-lg font-semibold text-text-primary">{worst?.deviceName ?? "—"}</div>
              {worst && <div className="text-xs text-text-secondary">{worst.availabilityPct}% available</div>}
            </BentoCard>
          </div>
        )}

        <BentoCard className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tighter text-text-primary">Availability — downtime by device</h2>
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
                  <XAxis
                    dataKey="deviceName"
                    tick={{ fontSize: 10, fill: "#A1A1AA" }}
                    axisLine={{ stroke: "#D4D4D8" }}
                    tickLine={false}
                    // Same overflow risk as Dashboard's category axes — a long device name has to be
                    // truncated before Recharts draws it, since SVG tick text doesn't wrap or ellipsize
                    // on its own and would overlap the neighboring bar.
                    tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
                  />
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
        </BentoCard>
      </div>
    </Layout>
  );
}

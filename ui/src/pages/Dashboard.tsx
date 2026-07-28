import { useEffect, useMemo, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, LayoutGrid, Rows3, SatelliteDish, Siren } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { StatusDot, statusColor } from "../components/StatusDot";
import { api } from "../api/client";
import { useWsMessages } from "../ws/WebSocketProvider";
import { useContainerSize } from "../hooks/useContainerSize";
import type { Alert } from "../api/alertTypes";
import { SEVERITY_COLOR, SEVERITY_HEX } from "../api/alertTypes";
import { CATEGORICAL_PALETTE, DEVICE_STATE_HEX, type DeviceState } from "../lib/statusTokens";
import type { Device, DeviceGroup, DeviceType } from "../api/types";
import { DEVICE_TYPE_LABELS } from "../api/types";
import { Card, EmptyState, Input, Select, SkeletonCards } from "../components/ui";
import { formatBps } from "../lib/format";

const SLA_TARGET_PCT = 99.9;
const AXIS_TICK = { fontSize: 10, fill: "#A1A1AA" };
const CHART_MUTED_FILL = "rgba(161,161,170,0.12)"; // text-muted at low opacity, for chart backgrounds/cursors
const STATE_ORDER: DeviceState[] = ["up", "degraded", "down", "flapping", "maintenance"];

interface Segment {
  key: string;
  label: string;
  count: number;
  color: string;
}

/** Small donut with a legend beside it and the total centered in the hole — used for both
 * fleet-health-by-state and open-alerts-by-severity, whose colors are the reserved status
 * palette (never the categorical one) since the segments ARE a status. */
function DonutCard({ title, segments }: { title: string; segments: Segment[] }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  return (
    <Card className="p-3">
      <div className="mb-2 text-xs text-text-secondary">{title}</div>
      {total === 0 ? (
        <div className="flex h-[92px] items-center justify-center text-xs text-text-muted">No data yet</div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative shrink-0" style={{ width: 92, height: 92 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={segments} dataKey="count" nameKey="label" innerRadius={28} outerRadius={44} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                  {segments.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-lg font-semibold tabular-nums text-text-primary">{total}</span>
              <span className="text-2xs uppercase tracking-wide text-text-muted">total</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 truncate text-text-secondary">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="font-mono tabular-nums text-text-primary">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function DonutTooltip({ active, payload, total }: { active?: boolean; payload?: Array<{ payload: Segment }>; total: number }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-text-primary">{row.label}</p>
      <p className="text-text-secondary">
        {row.count} · {pct}%
      </p>
    </div>
  );
}

/** Half-donut "gauge" (RadialBarChart from 180°→0°) — the one place a gauge genuinely fits: a
 * single number against a target, not a series to compare. */
function AvailabilityGauge({ pct }: { pct: number }) {
  const good = pct >= SLA_TARGET_PCT;
  const color = good ? DEVICE_STATE_HEX.up : pct >= 99 ? DEVICE_STATE_HEX.degraded : DEVICE_STATE_HEX.down;
  const data = [{ value: Math.min(100, Math.max(0, pct)) }];
  return (
    <Card className="p-3">
      <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
        <span>Availability today</span>
        <span>Target {SLA_TARGET_PCT}%</span>
      </div>
      <div className="relative mx-auto" style={{ width: "100%", maxWidth: 180, height: 92 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius="72%" outerRadius="100%" barSize={11} data={data} startAngle={180} endAngle={0} cx="50%" cy="88%">
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
            <RadialBar dataKey="value" cornerRadius={6} fill={color} background={{ fill: CHART_MUTED_FILL }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color }}>
            {pct}%
          </span>
        </div>
      </div>
    </Card>
  );
}

/** Device-type mix as a proportional strip — a resource-allocation question ("what kinds of
 * devices do I have"), not a status, so it draws from the fixed-order categorical palette rather
 * than status colors. Rendered as a segmented bar + legend rather than a pie: device-type counts
 * routinely exceed the ~5-category limit where pies stay readable (dataviz guidance), and a strip
 * reads proportion at a glance without forcing angle comparisons. */
function DeviceMixCard({ deviceMix }: { deviceMix: Array<{ type: string; label: string; count: number; pct: number }> }) {
  return (
    <Card className="p-3">
      <div className="mb-2 text-xs text-text-secondary">Device mix</div>
      {deviceMix.length === 0 ? (
        <div className="flex h-[92px] items-center justify-center text-xs text-text-muted">No devices yet</div>
      ) : (
        <div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-subtle">
            {deviceMix.map((d, i) => (
              <div
                key={d.type}
                style={{ width: `${Math.max(d.pct, 1)}%`, backgroundColor: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }}
                title={`${d.label}: ${d.count} (${d.pct}%)`}
              />
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {deviceMix.map((d, i) => (
              <div key={d.type} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 truncate text-text-secondary">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }} />
                  <span className="truncate">{d.label}</span>
                </span>
                <span className="font-mono tabular-nums text-text-primary">
                  {d.count} <span className="text-text-muted">({d.pct}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function LatencyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; lastLatencyMs: number; state: string | null } }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-text-primary">{row.name}</p>
      <p className="capitalize text-text-secondary">
        {row.lastLatencyMs} ms · {row.state ?? "unknown"}
      </p>
    </div>
  );
}

/** A small inline trend line beside each latency leader — real 6h latency history per device
 * (@api/routes/metrics.ts), not decoration. Fetched lazily once the leader list settles. */
function LatencySparkline({ deviceId, color }: { deviceId: string; color: string }) {
  const [points, setPoints] = useState<Array<{ ts: string; value: number }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ points: Array<{ ts: string; value: number }> }>(`/metrics/${deviceId}?range=6h&name=latencyMs`)
      .then((res) => {
        if (!cancelled) setPoints(res.points);
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (!points || points.length < 2) return <div className="h-6 w-16 shrink-0" />;

  return (
    <ResponsiveContainer width={64} height={24}>
      <LineChart data={points}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Devices per group, stacked by health state — the segments here genuinely are a status (each
 * device's own state), so it correctly draws from DEVICE_STATE_HEX rather than the categorical
 * palette, unlike the plain device-mix-by-type pie above. */
function GroupStateBarCard({ rows }: { rows: Array<{ label: string } & Record<DeviceState, number>> }) {
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-text-secondary">
        <span>Devices by group</span>
        <div className="hidden gap-2.5 sm:flex">
          {STATE_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: DEVICE_STATE_HEX[s] }} />
              <span className="capitalize">{s}</span>
            </span>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex h-[100px] items-center justify-center text-xs text-text-muted">No devices yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(60, rows.length * 26)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" width={100} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: CHART_MUTED_FILL }} content={<GroupStateTooltip />} />
            {STATE_ORDER.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="state" fill={DEVICE_STATE_HEX[s]} radius={i === STATE_ORDER.length - 1 ? [0, 4, 4, 0] : undefined} maxBarSize={16} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function GroupStateTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const nonZero = payload.filter((p) => p.value > 0);
  if (nonZero.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-text-primary">{label}</p>
      {nonZero.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-text-secondary">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="capitalize">{p.dataKey}</span>: <span className="font-mono tabular-nums text-text-primary">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Alert volume over the last 14 days, stacked by severity — real daily counts from
 * @api/routes/reports.ts's alerts-summary endpoint, the one place this page shows change over
 * time rather than a current snapshot. */
function AlertsTrendCard() {
  const [rows, setRows] = useState<Array<{ day: string; critical: number; warning: number; info: number }> | null>(null);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 13 * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);
    api
      .get<Array<{ day: string; severity: string; count: number }>>(
        `/reports/alerts-summary?from=${from.toISOString()}&to=${to.toISOString()}`
      )
      .then((raw) => {
        const byDay = new Map<string, { day: string; critical: number; warning: number; info: number }>();
        for (let i = 0; i < 14; i++) {
          const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
          const key = d.toISOString().slice(0, 10);
          byDay.set(key, { day: key, critical: 0, warning: 0, info: 0 });
        }
        for (const r of raw) {
          const bucket = byDay.get(r.day.slice(0, 10));
          if (bucket && (r.severity === "critical" || r.severity === "warning" || r.severity === "info")) {
            bucket[r.severity] = r.count;
          }
        }
        setRows([...byDay.values()]);
      })
      .catch(() => setRows([]));
  }, []);

  const total = rows?.reduce((s, r) => s + r.critical + r.warning + r.info, 0) ?? 0;

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-text-secondary">
        <span>Alerts opened, last 14 days</span>
        <div className="flex gap-2.5">
          {(["critical", "warning", "info"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1 capitalize">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_HEX[s] }} />
              {s}
            </span>
          ))}
        </div>
      </div>
      {rows === null ? (
        <div className="flex h-[140px] items-center justify-center text-xs text-text-muted">Loading…</div>
      ) : total === 0 ? (
        <div className="flex h-[140px] items-center justify-center text-xs text-text-muted">No alerts in the last 14 days</div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <XAxis
              dataKey="day"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
            <Tooltip content={<AlertsTrendTooltip />} />
            <Area type="monotone" dataKey="critical" stackId="sev" stroke={SEVERITY_HEX.critical} fill={SEVERITY_HEX.critical} fillOpacity={0.55} isAnimationActive={false} />
            <Area type="monotone" dataKey="warning" stackId="sev" stroke={SEVERITY_HEX.warning} fill={SEVERITY_HEX.warning} fillOpacity={0.5} isAnimationActive={false} />
            <Area type="monotone" dataKey="info" stackId="sev" stroke={SEVERITY_HEX.info} fill={SEVERITY_HEX.info} fillOpacity={0.45} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function AlertsTrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  if (total === 0) return null;
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-text-primary">{label ? new Date(label).toLocaleDateString() : ""}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-text-secondary">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="capitalize">{p.dataKey}</span>: <span className="font-mono tabular-nums text-text-primary">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

const HEATMAP_DAYS = 35;
const HEATMAP_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface HeatmapCell {
  date: string;
  critical: number;
  warning: number;
  info: number;
}

function heatmapCellColor(cell: HeatmapCell | undefined): string {
  if (!cell || cell.critical + cell.warning + cell.info === 0) return CHART_MUTED_FILL;
  if (cell.critical > 0) return SEVERITY_HEX.critical;
  if (cell.warning > 0) return SEVERITY_HEX.warning;
  return SEVERITY_HEX.info;
}

/** 5-week activity calendar, colored by the worst severity opened that day — real daily counts
 * from the same @api/routes/reports.ts alerts-summary endpoint AlertsTrendCard uses, just bucketed
 * by day-of-week/week instead of plotted as a trend line, so a viewer can spot a bad week or a
 * recurring bad weekday at a glance. */
function AlertHeatmapCard() {
  const [cells, setCells] = useState<Map<string, HeatmapCell> | null>(null);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - (HEATMAP_DAYS - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);
    api
      .get<Array<{ day: string; severity: string; count: number }>>(`/reports/alerts-summary?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((raw) => {
        const map = new Map<string, HeatmapCell>();
        for (let i = 0; i < HEATMAP_DAYS; i++) {
          const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
          const key = d.toISOString().slice(0, 10);
          map.set(key, { date: key, critical: 0, warning: 0, info: 0 });
        }
        for (const r of raw) {
          const cell = map.get(r.day.slice(0, 10));
          if (cell && (r.severity === "critical" || r.severity === "warning" || r.severity === "info")) cell[r.severity] = r.count;
        }
        setCells(map);
      })
      .catch(() => setCells(new Map()));
  }, []);

  const weeks = useMemo(() => {
    if (!cells) return [];
    const ordered = [...cells.values()];
    // Pad to a Monday start so every column is a full week.
    const firstDow = (new Date(ordered[0]!.date).getUTCDay() + 6) % 7; // 0=Mon
    const padded: Array<HeatmapCell | null> = [...Array(firstDow).fill(null), ...ordered];
    const cols: Array<Array<HeatmapCell | null>> = [];
    for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7));
    return cols;
  }, [cells]);

  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center justify-between text-xs text-text-secondary">
        <span>Alert activity (last {HEATMAP_DAYS} days)</span>
        <div className="hidden gap-2.5 sm:flex">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: CHART_MUTED_FILL }} /> None
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: SEVERITY_HEX.info }} /> Info
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: SEVERITY_HEX.warning }} /> Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: SEVERITY_HEX.critical }} /> Critical
          </span>
        </div>
      </div>
      {cells === null ? (
        <div className="flex h-[140px] items-center justify-center text-xs text-text-muted">Loading…</div>
      ) : (
        <>
          <div className="flex gap-3">
            <div className="flex flex-col justify-between py-0.5 text-2xs text-text-muted">
              {HEATMAP_WEEKDAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="flex flex-1 gap-1 overflow-x-auto">
              {weeks.map((col, i) => (
                <div key={i} className="flex flex-1 flex-col gap-1">
                  {col.map((cell, j) =>
                    cell ? (
                      <div
                        key={cell.date}
                        title={`${cell.date}: ${cell.critical + cell.warning + cell.info} alert${cell.critical + cell.warning + cell.info === 1 ? "" : "s"}`}
                        className="aspect-square w-full rounded-sm"
                        style={{ backgroundColor: heatmapCellColor(cell) }}
                      />
                    ) : (
                      <div key={j} className="aspect-square w-full" />
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
          {[...cells.values()].every((c) => c.critical + c.warning + c.info === 0) && (
            <p className="mt-2.5 text-center text-2xs text-text-muted">
              No alerts in the last {HEATMAP_DAYS} days — every cell above is a genuinely quiet day, not a loading state.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

const AVG_LATENCY_TARGET_MS = 100;

/** Two real headroom rows — how close the fleet is running to a target, not just whether it's
 * currently meeting it. Availability comes from the same SLA report /summary already computes;
 * average latency is derived client-side from the same device list the rest of this page uses, so
 * neither row introduces a fabricated metric the backend doesn't actually track. */
function SlaHeadroomCard({ availabilityPct, avgLatencyMs }: { availabilityPct: number; avgLatencyMs: number | null }) {
  const rows = [
    {
      label: "Network availability",
      actual: `${availabilityPct}%`,
      target: `${SLA_TARGET_PCT}%`,
      pct: Math.min(100, (availabilityPct / SLA_TARGET_PCT) * 100),
      good: availabilityPct >= SLA_TARGET_PCT,
    },
    ...(avgLatencyMs != null
      ? [
          {
            label: "Avg ICMP response",
            actual: `${avgLatencyMs} ms`,
            target: `< ${AVG_LATENCY_TARGET_MS} ms`,
            pct: Math.min(100, (avgLatencyMs / AVG_LATENCY_TARGET_MS) * 100),
            good: avgLatencyMs < AVG_LATENCY_TARGET_MS,
          },
        ]
      : []),
  ];

  return (
    <Card className="p-3">
      <div className="mb-3 text-xs text-text-secondary">SLA headroom</div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-text-secondary">{r.label}</span>
              <span className="font-mono tabular-nums text-text-primary">
                {r.actual} <span className="text-text-muted">/ target {r.target}</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${r.pct}%`, backgroundColor: r.good ? DEVICE_STATE_HEX.up : DEVICE_STATE_HEX.down }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

interface BandwidthCheck {
  id: string;
  deviceId: string;
  kind: string;
  enabled: boolean;
  config: { interfaces?: number[] };
}

/** Compact fleet-wide bandwidth summary — reuses the same SNMP interface counters
 * (@adapters/net/snmpMetrics.ts's if{N}.inBps/outBps) the dedicated Bandwidth page charts in
 * depth; this card only needs the latest point per configured interface plus a short trend, so it
 * fetches a narrower 1h window rather than duplicating that page's full aggregation. */
function BandwidthSummaryCard() {
  const [state, setState] = useState<"loading" | "empty" | "ready">("loading");
  const [points, setPoints] = useState<Array<{ ts: number; inbound: number; outbound: number }>>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const page = await api.get<{ items: Device[] }>("/devices?limit=2000").catch(() => ({ items: [] }));
      const snmpDevices = page.items.filter((d) => d.snmpCredsEnc);
      const checkEntries = await Promise.all(
        snmpDevices.map(async (d) => {
          const checks = await api.get<BandwidthCheck[]>(`/devices/${d.id}/checks`).catch(() => []);
          return checks.find((c) => c.kind === "snmp" && c.enabled && (c.config.interfaces?.length ?? 0) > 0);
        })
      );
      const targets = snmpDevices
        .map((d, i) => ({ device: d, check: checkEntries[i] }))
        .filter((t): t is { device: Device; check: BandwidthCheck } => !!t.check)
        .flatMap((t) => (t.check.config.interfaces ?? []).map((ifIndex) => ({ deviceId: t.device.id, ifIndex })))
        .slice(0, 8);

      if (targets.length === 0) {
        if (!cancelled) setState("empty");
        return;
      }

      const series = await Promise.all(
        targets.map(async (t) => {
          const [inRes, outRes] = await Promise.all([
            api.get<{ points: Array<{ ts: string; value: number }> }>(`/metrics/${t.deviceId}?range=1h&name=if${t.ifIndex}.inBps`).catch(() => ({ points: [] })),
            api.get<{ points: Array<{ ts: string; value: number }> }>(`/metrics/${t.deviceId}?range=1h&name=if${t.ifIndex}.outBps`).catch(() => ({ points: [] })),
          ]);
          return { inPoints: inRes.points, outPoints: outRes.points };
        })
      );

      if (cancelled) return;

      const bucketMs = 5 * 60 * 1000;
      const buckets = new Map<number, { inbound: number; outbound: number }>();
      for (const s of series) {
        for (const p of s.inPoints) {
          const key = Math.floor(new Date(p.ts).getTime() / bucketMs) * bucketMs;
          const b = buckets.get(key) ?? { inbound: 0, outbound: 0 };
          b.inbound += p.value;
          buckets.set(key, b);
        }
        for (const p of s.outPoints) {
          const key = Math.floor(new Date(p.ts).getTime() / bucketMs) * bucketMs;
          const b = buckets.get(key) ?? { inbound: 0, outbound: 0 };
          b.outbound += p.value;
          buckets.set(key, b);
        }
      }
      const merged = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([ts, v]) => ({ ts, ...v }));
      setPoints(merged);
      setTotalIn(series.reduce((sum, s) => sum + (s.inPoints[s.inPoints.length - 1]?.value ?? 0), 0));
      setTotalOut(series.reduce((sum, s) => sum + (s.outPoints[s.outPoints.length - 1]?.value ?? 0), 0));
      setState("ready");
    }
    load().catch(() => !cancelled && setState("empty"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-text-secondary">Bandwidth (last hour)</span>
        <Link to="/bandwidth" className="text-xs text-accent transition-opacity duration-150 hover:opacity-80">
          View all →
        </Link>
      </div>
      {state === "loading" ? (
        <div className="flex h-[100px] items-center justify-center text-xs text-text-muted">Loading…</div>
      ) : state === "empty" ? (
        <div className="flex h-[100px] flex-col items-center justify-center gap-1 text-center text-xs text-text-muted">
          <span>No interfaces configured yet.</span>
          <Link to="/bandwidth" className="text-accent hover:opacity-80">
            Set up bandwidth monitoring →
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-2 flex gap-4">
            <div>
              <div className="flex items-center gap-1 text-2xs text-text-muted">
                <ArrowDown size={11} className="text-info" aria-hidden="true" /> Inbound
              </div>
              <div className="font-mono text-base font-semibold tabular-nums text-text-primary">{formatBps(totalIn)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-2xs text-text-muted">
                <ArrowUp size={11} className="text-accent" aria-hidden="true" /> Outbound
              </div>
              <div className="font-mono text-base font-semibold tabular-nums text-text-primary">{formatBps(totalOut)}</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={64}>
            <AreaChart data={points} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Area type="monotone" dataKey="inbound" stroke="#39C5D8" fill="#39C5D8" fillOpacity={0.3} strokeWidth={1.25} isAnimationActive={false} />
              <Area type="monotone" dataKey="outbound" stroke="#6757E8" fill="#6757E8" fillOpacity={0.18} strokeWidth={1.25} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </Card>
  );
}

/** Wide, scannable open-alerts table — replaces a narrow always-visible ticker with something a
 * viewer can actually triage (severity + status + how long it's been open), sourced from the same
 * /alerts endpoint the ticker used, just filtered to open and capped to the worst few. */
function CriticalAlertsTable() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const navigate = useNavigate();

  async function load() {
    const page = await api.get<{ items: Alert[] }>("/alerts?status=open&limit=8");
    setAlerts(page.items);
  }

  useEffect(() => {
    load().catch(() => setAlerts([]));
  }, []);

  useWsMessages((msg) => {
    const evt = msg as { type?: string };
    if (evt.type === "alert.changed" || evt.type === "__reconnected") load().catch(() => {});
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Siren size={13} aria-hidden="true" /> Open alerts
        </span>
        <Link to="/alerts" className="text-xs text-accent transition-opacity duration-150 hover:opacity-80">
          View all →
        </Link>
      </div>
      {alerts === null ? (
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-border text-xs text-text-muted">Loading…</div>
      ) : alerts.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-border text-xs text-text-muted">No open alerts. Fleet is quiet.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle/60 text-left text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Alert</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => navigate(`/devices/${a.deviceId}`)}
                  className="cursor-pointer border-t border-border transition-colors duration-150 hover:bg-bg-subtle/40"
                >
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium capitalize ${SEVERITY_COLOR[a.severity]}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-primary">{a.title}</td>
                  <td className="px-3 py-2 text-text-secondary">{new Date(a.openedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 capitalize text-text-secondary">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface DeviceRow {
  id: string;
  name: string;
  ip: string;
  type: DeviceType;
  groupId: string | null;
  state: string | null;
  lastLatencyMs: number | null;
}

interface Summary {
  totalDevices: number;
  byState: Record<string, number>;
  openAlerts: Record<string, number>;
  availabilityTodayPct: number;
}

const CARD_MIN_WIDTH = 240;
const CARD_HEIGHT = 104;
const ROW_GAP = 12;

function DeviceCard({ device, onClick }: { device: DeviceRow; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-full w-full cursor-pointer flex-col justify-between rounded-lg border border-border bg-bg-surface p-3 text-left transition-colors duration-micro hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
    >
      <div className="flex items-center justify-between">
        <span className="truncate text-sm font-medium text-text-primary">{device.name}</span>
        <StatusDot state={device.state} pulse={device.state === "down" || device.state === "flapping"} />
      </div>
      <div className="text-xs text-text-secondary">
        {DEVICE_TYPE_LABELS[device.type]} · <span className="font-mono">{device.ip}</span>
      </div>
      <div className="font-mono text-xs text-text-secondary">{device.lastLatencyMs != null ? `${device.lastLatencyMs} ms` : "—"}</div>
    </button>
  );
}

function GridRow({
  index,
  style,
  devices,
  columns,
  onSelect,
}: RowComponentProps<{ devices: DeviceRow[]; columns: number; onSelect: (id: string) => void }>) {
  const start = index * columns;
  const rowDevices = devices.slice(start, start + columns);
  return (
    <div style={{ ...style, display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: ROW_GAP, paddingBottom: ROW_GAP }}>
      {rowDevices.map((d) => (
        <DeviceCard key={d.id} device={d} onClick={() => onSelect(d.id)} />
      ))}
    </div>
  );
}

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statHistory, setStatHistory] = useState<
    Array<{ totalDevices: number; up: number; degraded: number; down: number; openAlerts: number; availabilityTodayPct: number }>
  >([]);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();
  const { ref: gridRef, size } = useContainerSize<HTMLDivElement>();

  // Reveal-on-mount for the top strip only (the one above-the-fold entrance this page animates —
  // "1-2 key elements max," not every card on the page). Starts hidden, flips true next frame so
  // the .reveal -> .reveal-visible CSS transition actually has something to animate from.
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  const STAT_HISTORY_MAX = 30;

  async function loadSummary() {
    const s = await api.get<Summary>("/summary");
    setSummary(s);
    setStatHistory((prev) =>
      [
        ...prev,
        {
          totalDevices: s.totalDevices,
          up: s.byState.up ?? 0,
          degraded: s.byState.degraded ?? 0,
          down: s.byState.down ?? 0,
          openAlerts: (s.openAlerts.critical ?? 0) + (s.openAlerts.warning ?? 0) + (s.openAlerts.info ?? 0),
          availabilityTodayPct: s.availabilityTodayPct,
        },
      ].slice(-STAT_HISTORY_MAX)
    );
  }

  async function loadDevices() {
    const params = new URLSearchParams({ withStatus: "true", limit: "2000" });
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);
    if (groupFilter) params.set("groupId", groupFilter);
    const page = await api.get<{ items: DeviceRow[] }>(`/devices?${params.toString()}`);
    setDevices(page.items);
  }

  useEffect(() => {
    loadSummary().catch(() => {});
    api.get<DeviceGroup[]>("/groups").then(setGroups).catch(() => {});
  }, []);

  useEffect(() => {
    loadDevices().catch(() => {});
  }, [search, typeFilter, groupFilter]);

  useWsMessages((msg) => {
    const evt = msg as { type?: string };
    if (evt.type === "device.status_changed" || evt.type === "__reconnected") {
      loadDevices().catch(() => {});
      loadSummary().catch(() => {});
    }
    if (evt.type === "alert.changed" || evt.type === "__reconnected") {
      loadSummary().catch(() => {});
    }
  });

  const filteredDevices = useMemo(
    () => (stateFilter ? (devices ?? []).filter((d) => d.state === stateFilter) : devices ?? []),
    [devices, stateFilter]
  );

  const stateSegments: Segment[] = useMemo(
    () =>
      STATE_ORDER.map((s) => ({
        key: s,
        label: s[0]!.toUpperCase() + s.slice(1),
        count: summary?.byState[s] ?? 0,
        color: statusColor(s),
      })),
    [summary]
  );

  const alertSegments: Segment[] = useMemo(
    () =>
      (["critical", "warning", "info"] as const).map((s) => ({
        key: s,
        label: s[0]!.toUpperCase() + s.slice(1),
        count: summary?.openAlerts[s] ?? 0,
        color: SEVERITY_HEX[s],
      })),
    [summary]
  );

  const MAX_DEVICE_MIX_ROWS = 6;
  const deviceMix = useMemo(() => {
    const counts = new Map<DeviceType, number>();
    for (const d of devices ?? []) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
    const total = (devices ?? []).length || 1;
    const ranked = [...counts.entries()]
      .map(([type, count]) => ({ type: type as string, label: DEVICE_TYPE_LABELS[type], count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
    if (ranked.length <= MAX_DEVICE_MIX_ROWS) return ranked;
    const head = ranked.slice(0, MAX_DEVICE_MIX_ROWS - 1);
    const otherCount = ranked.slice(MAX_DEVICE_MIX_ROWS - 1).reduce((sum, r) => sum + r.count, 0);
    return [...head, { type: "other", label: "Other", count: otherCount, pct: Math.round((otherCount / total) * 100) }];
  }, [devices]);

  const latencyLeaders = useMemo(
    () =>
      (devices ?? [])
        .filter((d): d is DeviceRow & { lastLatencyMs: number } => d.lastLatencyMs != null)
        .sort((a, b) => b.lastLatencyMs - a.lastLatencyMs)
        .slice(0, 8),
    [devices]
  );

  const groupStateRows = useMemo(() => {
    const map = new Map<string, { label: string } & Record<DeviceState, number>>();
    for (const d of devices ?? []) {
      const gid = d.groupId ?? "__ungrouped";
      if (!map.has(gid)) {
        map.set(gid, {
          label: gid === "__ungrouped" ? "Ungrouped" : groups.find((g) => g.id === gid)?.name ?? "Unknown group",
          up: 0,
          degraded: 0,
          down: 0,
          flapping: 0,
          maintenance: 0,
        });
      }
      const row = map.get(gid)!;
      const state = (d.state ?? "up") as DeviceState;
      if (state in row) row[state]++;
    }
    return [...map.values()].sort((a, b) => (b.up + b.degraded + b.down + b.flapping + b.maintenance) - (a.up + a.degraded + a.down + a.flapping + a.maintenance));
  }, [devices, groups]);

  const avgLatencyMs = useMemo(() => {
    const withLatency = (devices ?? []).filter((d): d is DeviceRow & { lastLatencyMs: number } => d.lastLatencyMs != null);
    if (withLatency.length === 0) return null;
    return Math.round(withLatency.reduce((sum, d) => sum + d.lastLatencyMs, 0) / withLatency.length);
  }, [devices]);

  const columns = Math.max(1, Math.floor((size.width + ROW_GAP) / (CARD_MIN_WIDTH + ROW_GAP)));
  const rowCount = Math.ceil(filteredDevices.length / columns);
  const loading = devices === null;

  return (
    <Layout title="Executive Overview" subtitle="Real-time summary of network health and performance">
      <div className="space-y-6">
        {/* Top strip — asymmetric: one hero focal point (the number an operator checks first),
            not six identical boxes competing for attention. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div
            className={`md:col-span-4 transition-all duration-300 ease-out-expo ${mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
          >
            <HeroAvailabilityTile pct={summary?.availabilityTodayPct ?? 100} trend={statHistory.map((h) => h.availabilityTodayPct)} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:col-span-8 lg:grid-cols-5">
            {[
              { label: "Devices", value: summary?.totalDevices ?? "…", tone: undefined, trend: statHistory.map((h) => h.totalDevices) },
              { label: "Up", value: summary?.byState.up ?? 0, tone: "success" as const, trend: statHistory.map((h) => h.up) },
              { label: "Degraded", value: summary?.byState.degraded ?? 0, tone: "warning" as const, trend: statHistory.map((h) => h.degraded) },
              { label: "Down", value: summary?.byState.down ?? 0, tone: "critical" as const, trend: statHistory.map((h) => h.down) },
              {
                label: "Open alerts",
                value: (summary?.openAlerts.critical ?? 0) + (summary?.openAlerts.warning ?? 0) + (summary?.openAlerts.info ?? 0),
                tone: undefined,
                trend: statHistory.map((h) => h.openAlerts),
              },
            ].map((tile, i) => (
              <div
                key={tile.label}
                className={`transition-all duration-300 ease-out-expo ${mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
                style={{ transitionDelay: mounted ? `${60 + i * 40}ms` : "0ms" }}
              >
                <StatTile label={tile.label} value={tile.value} tone={tile.tone} trend={tile.trend} />
              </div>
            ))}
          </div>
        </div>

        {/* Fleet overview */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DonutCard title="Fleet health" segments={stateSegments} />
          <DonutCard title="Open alerts by severity" segments={alertSegments} />
          <AvailabilityGauge pct={summary?.availabilityTodayPct ?? 100} />
          <DeviceMixCard deviceMix={deviceMix} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="p-3">
            <div className="mb-2 text-xs text-text-secondary">Latency leaders (highest response time)</div>
            {latencyLeaders.length === 0 ? (
              <div className="flex h-[100px] items-center justify-center text-xs text-text-muted">No latency data yet</div>
            ) : (
              <div className="space-y-1">
                <ResponsiveContainer width="100%" height={Math.max(60, latencyLeaders.length * 24)}>
                  <BarChart data={latencyLeaders} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={100} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <Tooltip content={<LatencyTooltip />} cursor={{ fill: CHART_MUTED_FILL }} />
                    <Bar dataKey="lastLatencyMs" radius={[0, 4, 4, 0]} maxBarSize={14}>
                      {latencyLeaders.map((d) => (
                        <Cell key={d.id} fill={statusColor(d.state)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="space-y-1 border-t border-border pt-2">
                  {latencyLeaders.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 text-2xs text-text-secondary">
                      <span className="truncate">{d.name}</span>
                      <LatencySparkline deviceId={d.id} color={statusColor(d.state)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <GroupStateBarCard rows={groupStateRows} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <AlertHeatmapCard />
          <AlertsTrendCard />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <SlaHeadroomCard availabilityPct={summary?.availabilityTodayPct ?? 100} avgLatencyMs={avgLatencyMs} />
          <BandwidthSummaryCard />
        </div>

        <CriticalAlertsTable />

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input placeholder="Search name or IP…" value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-[10rem] flex-1 sm:flex-none" />
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {(Object.keys(DEVICE_TYPE_LABELS) as DeviceType[]).map((t) => (
                  <option key={t} value={t}>
                    {DEVICE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-auto">
                <option value="">All groups</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
              <Select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="w-auto">
                <option value="">All states</option>
                <option value="up">Up</option>
                <option value="degraded">Degraded</option>
                <option value="down">Down</option>
                <option value="flapping">Flapping</option>
                <option value="maintenance">Maintenance</option>
              </Select>
              <div className="ml-auto flex overflow-hidden rounded-md border border-border text-xs">
                <button
                  onClick={() => setViewMode("grid")}
                  aria-pressed={viewMode === "grid"}
                  className={`flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 transition-colors duration-micro ${viewMode === "grid" ? "bg-bg-subtle text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
                >
                  <LayoutGrid size={13} aria-hidden="true" /> Grid
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  aria-pressed={viewMode === "table"}
                  className={`flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 transition-colors duration-micro ${viewMode === "table" ? "bg-bg-subtle text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
                >
                  <Rows3 size={13} aria-hidden="true" /> Table
                </button>
              </div>
            </div>

            {loading ? (
              <SkeletonCards count={9} />
            ) : filteredDevices.length === 0 ? (
              <EmptyState
                icon={SatelliteDish}
                title="No devices match your filters"
                description="Try clearing a filter, or head to Discovery to scan your network for new devices."
              />
            ) : viewMode === "grid" ? (
              <div ref={gridRef} style={{ height: "70vh" }}>
                {size.width > 0 && (
                  <List
                    rowCount={rowCount}
                    rowHeight={CARD_HEIGHT + ROW_GAP}
                    rowComponent={GridRow}
                    rowProps={{ devices: filteredDevices, columns, onSelect: (id: string) => navigate(`/devices/${id}`) }}
                    style={{ height: size.height || 600 }}
                  />
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-bg-subtle/60 text-left text-text-secondary">
                    <tr>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">IP</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDevices.slice(0, 500).map((d) => (
                      <tr
                        key={d.id}
                        onClick={() => navigate(`/devices/${d.id}`)}
                        className="cursor-pointer border-t border-border transition-colors duration-micro hover:bg-bg-subtle/40"
                      >
                        <td className="px-3 py-2">
                          <StatusDot state={d.state} />
                        </td>
                        <td className="px-3 py-2 text-text-primary">{d.name}</td>
                        <td className="px-3 py-2 font-mono text-text-primary">{d.ip}</td>
                        <td className="px-3 py-2 text-text-secondary">{DEVICE_TYPE_LABELS[d.type]}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">{d.lastLatencyMs != null ? `${d.lastLatencyMs} ms` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </Layout>
  );
}

/** One heartbeat-shaped path, tileable edge-to-edge (starts and ends at baseline y=20 so two
 * copies placed side by side read as one continuous rhythm, not a visible seam). This is the
 * signature element referenced in docs/improvement-plan/01-DESIGN-SYSTEM.md — a live pulse trace
 * instead of the generic radial-progress-ring every SaaS dashboard already reaches for, because a
 * heartbeat is literally what an uptime monitor watches: an unbroken rhythm, or the flat/spiked
 * line that means it wasn't. */
const PULSE_PATH = "M0,20 L14,20 L19,20 L23,6 L27,34 L31,14 L35,20 L48,20 L100,20";

function PulseTrace({ color, flatline }: { color: string; flatline: boolean }) {
  return (
    <div className="relative h-9 w-full overflow-hidden" aria-hidden="true">
      <div className={`flex h-full w-[200%] ${flatline ? "" : "pulse-scroll"}`}>
        {[0, 1].map((copy) => (
          <svg key={copy} viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-1/2">
            <path
              d={flatline ? "M0,20 L100,20" : PULSE_PATH}
              fill="none"
              stroke={color}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ))}
      </div>
      {/* Edge fade is a mask on a flat single-color layer, not a gradient fill — the mask's alpha
          channel is a gradient, but the visible color underneath (bg-bg-surface) never varies. */}
      <div
        className="pointer-events-none absolute inset-0 bg-bg-surface"
        style={{
          maskImage: "linear-gradient(to right, black, transparent, black)",
          WebkitMaskImage: "linear-gradient(to right, black, transparent, black)",
        }}
      />
      <style>{`
        @keyframes argus-pulse-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .pulse-scroll { animation: argus-pulse-scroll 3s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .pulse-scroll { animation: none; }
        }
      `}</style>
    </div>
  );
}

/** The one focal point of the top strip — a live pulse trace + the biggest number on the page
 * (text-3xl, the display-headline step of the type scale), deliberately distinct from the
 * half-donut AvailabilityGauge further down the page (that one sits among peers in a 4-up row and
 * reads as one of several; this one has to read as "the number that matters most" from across a
 * NOC room). Same real `statHistory` trend data as every other tile — no fabricated comparison. */
function HeroAvailabilityTile({ pct, trend }: { pct: number; trend: number[] }) {
  const good = pct >= SLA_TARGET_PCT;
  const color = good ? DEVICE_STATE_HEX.up : pct >= 99 ? DEVICE_STATE_HEX.degraded : DEVICE_STATE_HEX.down;
  return (
    <Card className="h-full p-5 transition-shadow duration-micro ease-out-expo hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xs font-medium uppercase tracking-tight text-text-secondary">Availability today</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-3xl font-bold tabular-nums tracking-tightest transition-colors" style={{ color }}>
              {pct}%
            </span>
          </div>
          <div className="mt-0.5 text-2xs text-text-muted">target {SLA_TARGET_PCT}%</div>
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      </div>
      <PulseTrace color={color} flatline={trend.length < 2} />
    </Card>
  );
}

/** `trend` is a live client-side buffer of this session's own polls (see Dashboard's statHistory),
 * not a "vs yesterday" comparison the backend has no data for — real, just short-window, which is
 * why it's drawn plainly rather than paired with a fabricated delta label. */
function StatTile({
  label,
  value,
  tone,
  trend,
}: {
  label: string;
  value: string | number;
  tone?: "success" | "warning" | "critical";
  trend?: number[];
}) {
  const toneClass = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "critical" ? "text-critical" : "text-text-primary";
  const sparkColor = tone === "success" ? DEVICE_STATE_HEX.up : tone === "warning" ? DEVICE_STATE_HEX.degraded : tone === "critical" ? DEVICE_STATE_HEX.down : "#A1A1AA";
  const sparkData = (trend ?? []).map((v, i) => ({ i, v }));
  return (
    <Card className="h-full p-3.5 transition-shadow duration-micro ease-out-expo hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-2xs font-medium text-text-secondary">{label}</div>
          <div className={`mt-1 font-mono text-xl font-semibold tabular-nums tracking-tighter transition-colors ${toneClass}`}>{value}</div>
        </div>
        {sparkData.length >= 2 && (
          <div className="mt-1 h-8 w-14 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}

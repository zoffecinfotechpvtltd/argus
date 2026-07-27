import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Gauge, Sliders } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import type { Device } from "../api/types";
import { Card, EmptyState, Input, SkeletonCards, useToast } from "../components/ui";
import { formatBps } from "../lib/format";

interface Check {
  id: string;
  deviceId: string;
  kind: string;
  enabled: boolean;
  config: { interfaces?: number[] };
}

interface MetricPoint {
  ts: string;
  value: number;
}

const RANGES = ["1h", "6h", "24h"] as const;
type Range = (typeof RANGES)[number];

const BUCKET_MS: Record<Range, number> = {
  "1h": 60 * 1000,
  "6h": 5 * 60 * 1000,
  "24h": 15 * 60 * 1000,
};

const AXIS_TICK = { fontSize: 10, fill: "#A1A1AA" };

interface InterfaceSeries {
  deviceId: string;
  deviceName: string;
  ifIndex: number;
  inPoints: MetricPoint[];
  outPoints: MetricPoint[];
}

function latest(points: MetricPoint[]): number {
  return points.length > 0 ? points[points.length - 1]!.value : 0;
}

function mergeTotals(seriesList: MetricPoint[][], bucketMs: number): Array<{ ts: number; value: number }> {
  const buckets = new Map<number, number>();
  for (const series of seriesList) {
    for (const p of series) {
      const key = Math.floor(new Date(p.ts).getTime() / bucketMs) * bucketMs;
      buckets.set(key, (buckets.get(key) ?? 0) + p.value);
    }
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([ts, value]) => ({ ts, value }));
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-text-primary">{label ? new Date(label).toLocaleTimeString() : ""}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-text-secondary">
          <span className="capitalize">{p.dataKey}</span>: <span className="tabular-nums text-text-primary">{formatBps(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Interface config editor for one SNMP-capable device — writes to the check's existing generic
 * `config` field (@api/routes/checks.ts already accepts a partial config patch), so turning on
 * bandwidth monitoring needs no backend change: just populating `interfaces` on its snmp check. */
function InterfaceConfigRow({ device, check, onSaved }: { device: Device; check: Check; onSaved: () => void }) {
  const [value, setValue] = useState((check.config.interfaces ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    const interfaces = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    setSaving(true);
    try {
      await api.patch(`/checks/${check.id}`, { config: { interfaces } });
      toast.success(`Updated interfaces for ${device.name}.`);
      onSaved();
    } catch {
      toast.error("Failed to update interfaces.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">{device.name}</div>
        <div className="truncate text-xs text-text-secondary font-mono">{device.ip}</div>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. 1, 2, 3"
        className="w-40 font-mono text-xs"
        aria-label={`Interface indices for ${device.name}`}
      />
      <button
        onClick={save}
        disabled={saving}
        className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:bg-bg-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function Bandwidth() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [series, setSeries] = useState<InterfaceSeries[]>([]);
  const [range, setRange] = useState<Range>("6h");
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const navigate = useNavigate();

  async function loadDevicesAndChecks() {
    const page = await api.get<{ items: Device[] }>("/devices?limit=2000");
    const snmpDevices = page.items.filter((d) => d.snmpCredsEnc);
    setDevices(snmpDevices);

    const entries = await Promise.all(
      snmpDevices.map(async (d) => {
        const deviceChecks = await api.get<Check[]>(`/devices/${d.id}/checks`).catch(() => []);
        const snmpCheck = deviceChecks.find((c) => c.kind === "snmp");
        return [d.id, snmpCheck] as const;
      })
    );
    const next: Record<string, Check> = {};
    for (const [id, check] of entries) if (check) next[id] = check;
    setChecks(next);
  }

  useEffect(() => {
    loadDevicesAndChecks().catch(() => setDevices([]));
  }, []);

  const monitoredTargets = useMemo(() => {
    if (!devices) return [];
    const targets: Array<{ device: Device; ifIndex: number }> = [];
    for (const d of devices) {
      const check = checks[d.id];
      if (!check?.enabled) continue;
      for (const ifIndex of check.config.interfaces ?? []) targets.push({ device: d, ifIndex });
    }
    return targets.slice(0, 16);
  }, [devices, checks]);

  useEffect(() => {
    let cancelled = false;
    if (monitoredTargets.length === 0) {
      setSeries([]);
      return;
    }
    setLoadingSeries(true);
    Promise.all(
      monitoredTargets.map(async ({ device, ifIndex }) => {
        const [inRes, outRes] = await Promise.all([
          api.get<{ points: MetricPoint[] }>(`/metrics/${device.id}?range=${range}&name=if${ifIndex}.inBps`).catch(() => ({ points: [] })),
          api.get<{ points: MetricPoint[] }>(`/metrics/${device.id}?range=${range}&name=if${ifIndex}.outBps`).catch(() => ({ points: [] })),
        ]);
        const s: InterfaceSeries = { deviceId: device.id, deviceName: device.name, ifIndex, inPoints: inRes.points, outPoints: outRes.points };
        return s;
      })
    ).then((results) => {
      if (!cancelled) {
        setSeries(results);
        setLoadingSeries(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [monitoredTargets, range]);

  const bucketMs = BUCKET_MS[range];
  const chartData = useMemo(() => {
    const inTotals = mergeTotals(
      series.map((s) => s.inPoints),
      bucketMs
    );
    const outTotals = mergeTotals(
      series.map((s) => s.outPoints),
      bucketMs
    );
    const byTs = new Map<number, { ts: number; inbound: number; outbound: number }>();
    for (const { ts, value } of inTotals) byTs.set(ts, { ts, inbound: value, outbound: byTs.get(ts)?.outbound ?? 0 });
    for (const { ts, value } of outTotals) byTs.set(ts, { ts, inbound: byTs.get(ts)?.inbound ?? 0, outbound: value });
    return [...byTs.values()].sort((a, b) => a.ts - b.ts);
  }, [series, bucketMs]);

  const totalInbound = series.reduce((sum, s) => sum + latest(s.inPoints), 0);
  const totalOutbound = series.reduce((sum, s) => sum + latest(s.outPoints), 0);

  const rankedInterfaces = useMemo(
    () =>
      [...series]
        .map((s) => ({ ...s, in: latest(s.inPoints), out: latest(s.outPoints) }))
        .sort((a, b) => b.in + b.out - (a.in + a.out)),
    [series]
  );

  const unconfigured = (devices ?? []).filter((d) => !checks[d.id] || !(checks[d.id]!.config.interfaces?.length));

  return (
    <Layout title="Bandwidth" subtitle="SNMP interface throughput across monitored devices">
      <div className="space-y-6">
        {devices === null ? (
          <SkeletonCards count={3} />
        ) : devices.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="No SNMP-enabled devices yet"
            description="Bandwidth monitoring reads interface counters over SNMP. Add an SNMP community string to a device in Inventory to start tracking its traffic here."
          />
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card className="p-4">
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <ArrowDown size={14} className="text-info" aria-hidden="true" />
                  Total inbound (current)
                </div>
                <div className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tighter text-text-primary">{formatBps(totalInbound)}</div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <ArrowUp size={14} className="text-accent" aria-hidden="true" />
                  Total outbound (current)
                </div>
                <div className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tighter text-text-primary">{formatBps(totalOutbound)}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-text-secondary">Interfaces monitored</div>
                <div className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tighter text-text-primary">{monitoredTargets.length}</div>
              </Card>
            </div>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-text-primary">Aggregate throughput</div>
                <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      aria-pressed={range === r}
                      className={`cursor-pointer rounded px-2.5 py-1 transition-colors duration-150 ${
                        range === r ? "bg-accent text-accent-text-on" : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {monitoredTargets.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-center text-xs text-text-secondary/70">
                  No interfaces configured yet — use "Configure interfaces" below to pick which ones to track.
                </div>
              ) : loadingSeries && chartData.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-xs text-text-secondary/70">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="ts"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      minTickGap={40}
                    />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatBps(v)} width={64} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="inbound" stroke="#2563EB" fill="#2563EB" fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
                    <Area type="monotone" dataKey="outbound" stroke="#4F46E5" fill="#4F46E5" fillOpacity={0.2} strokeWidth={1.5} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
              <div className="mt-2 flex gap-4 text-xs text-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-info" /> Inbound
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-accent" /> Outbound
                </span>
              </div>
            </Card>

            {rankedInterfaces.length > 0 && (
              <Card className="p-4">
                <div className="mb-3 text-sm font-medium text-text-primary">Top interfaces by current throughput</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-xs text-text-secondary">
                      <tr>
                        <th className="px-2 py-1.5">Device</th>
                        <th className="px-2 py-1.5">Interface</th>
                        <th className="px-2 py-1.5">Inbound</th>
                        <th className="px-2 py-1.5">Outbound</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedInterfaces.map((s) => (
                        <tr
                          key={`${s.deviceId}-${s.ifIndex}`}
                          onClick={() => navigate(`/devices/${s.deviceId}`)}
                          className="cursor-pointer border-b border-border/60 transition-colors duration-150 last:border-b-0 hover:bg-bg-subtle/50"
                        >
                          <td className="px-2 py-2 text-text-primary">{s.deviceName}</td>
                          <td className="px-2 py-2 text-text-secondary">if{s.ifIndex}</td>
                          <td className="px-2 py-2 tabular-nums text-text-primary">{formatBps(s.in)}</td>
                          <td className="px-2 py-2 tabular-nums text-text-primary">{formatBps(s.out)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card className="p-4">
              <button onClick={() => setShowConfig((v) => !v)} className="flex w-full cursor-pointer items-center justify-between text-left">
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <Sliders size={15} className="text-text-secondary" aria-hidden="true" />
                  Configure interfaces
                  {unconfigured.length > 0 && <span className="text-xs font-normal text-text-secondary">({unconfigured.length} not yet configured)</span>}
                </span>
                <span className="text-xs text-text-secondary">{showConfig ? "Hide" : "Show"}</span>
              </button>
              {showConfig && (
                <div className="mt-3">
                  <p className="mb-2 text-xs text-text-secondary">
                    Enter the SNMP interface indices (ifIndex, e.g. from a switch's ifTable) to poll for each device. Leave blank to stop tracking a device's
                    bandwidth.
                  </p>
                  {devices.map((d) => {
                    const check = checks[d.id];
                    if (!check) return null;
                    return <InterfaceConfigRow key={d.id} device={d} check={check} onSaved={loadDevicesAndChecks} />;
                  })}
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}

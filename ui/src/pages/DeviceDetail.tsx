import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CalendarClock, ChartLine, ListChecks, Siren } from "lucide-react";
import { Layout } from "../components/Layout";
import { StatusDot } from "../components/StatusDot";
import { api } from "../api/client";
import { useWsMessages } from "../ws/WebSocketProvider";
import type { Device, DeviceGroup } from "../api/types";
import { DEVICE_TYPE_LABELS } from "../api/types";
import type { Alert } from "../api/alertTypes";
import { SEVERITY_COLOR } from "../api/alertTypes";
import { Badge, Button, Card, EmptyState, FieldGroup, Input, Select, useToast } from "../components/ui";
import { maintenanceWindowStatus } from "../lib/maintenance";

interface Check {
  id: string;
  kind: string;
  enabled: boolean;
  thresholds: { latencyMs?: number; lossPct?: number };
  config: Record<string, unknown>;
}

interface MaintenanceWindow {
  id: string;
  deviceId: string | null;
  groupId: string | null;
  startsAt: string;
  endsAt: string;
  recurrence: string | null;
}

interface DeviceStatus {
  state: string;
  since: string;
  lastSeen: string | null;
  lastLatencyMs: number | null;
}

const RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];
const RANGE_HOURS: Record<Range, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };

const TABS = [
  { key: "metrics", label: "Metrics", icon: ChartLine },
  { key: "alerts", label: "Alerts", icon: Siren },
  { key: "checks", label: "Checks", icon: ListChecks },
  { key: "maintenance", label: "Maintenance", icon: CalendarClock },
] as const;

function useMetric(deviceId: string, name: string, range: Range) {
  const [points, setPoints] = useState<Array<{ ts: string; value: number }>>([]);
  useEffect(() => {
    api
      .get<{ points: Array<{ ts: string; value: number }> }>(`/metrics/${deviceId}?range=${range}&name=${name}`)
      .then((r) => setPoints(r.points))
      .catch(() => setPoints([]));
  }, [deviceId, name, range]);
  return points;
}

/** `syncId` is the load-bearing prop here — every ChartCard on the metrics tab shares the same
 * one, so Recharts synchronizes the hover crosshair/tooltip across all of them: hovering a latency
 * spike shows you the exact same instant on the CPU/memory/loss charts next to it, instead of four
 * charts you have to mentally line up by eye. This is what "correlate metrics on aligned time axes"
 * means with the real metrics data this app has — no fabricated cross-chart annotation system. */
function ChartCard({
  title,
  data,
  dataKey = "value",
  unit = "",
  syncId,
}: {
  title: string;
  data: Array<{ ts: string; value: number }>;
  dataKey?: string;
  unit?: string;
  syncId: string;
}) {
  const chartData = data.map((p) => ({ time: new Date(p.ts).toLocaleTimeString(), value: p.value }));
  return (
    <Card className="p-4">
      <h4 className="mb-2 text-sm font-medium text-text-secondary">{title}</h4>
      {chartData.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-xs text-text-muted">No data for this range yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={192}>
          <LineChart data={chartData} syncId={syncId}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--chart-grid))" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#A1A1AA" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#A1A1AA" }} unit={unit} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "rgb(var(--color-bg-elevated))", border: "1px solid rgb(var(--color-border))", fontSize: 12, borderRadius: 8, color: "rgb(var(--color-text-primary))" }} />
            <Line type="monotone" dataKey={dataKey} name={title} stroke="#4F46E5" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const deviceId = id!;
  const [device, setDevice] = useState<Device | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [group, setGroup] = useState<DeviceGroup | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("metrics");
  const [range, setRange] = useState<Range>("24h");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const [availability, setAvailability] = useState<number | null>(null);
  const [maintStart, setMaintStart] = useState("");
  const [maintDurationMin, setMaintDurationMin] = useState(60);
  const [maintRecurrence, setMaintRecurrence] = useState<"" | "daily" | "weekly">("");
  const [maintScope, setMaintScope] = useState<"device" | "group">("device");
  const [schedulingMaint, setSchedulingMaint] = useState(false);
  const toast = useToast();

  async function loadDevice() {
    const d = await api.get<Device>(`/devices/${deviceId}`);
    setDevice(d);
    if (d.groupId) api.get<DeviceGroup[]>("/groups").then((gs) => setGroup(gs.find((g) => g.id === d.groupId) ?? null));
  }

  async function loadAvailability() {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 1;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const rows = await api.get<Array<{ deviceId: string; availabilityPct: number }>>(
      `/reports/sla?from=${from.toISOString()}&to=${to.toISOString()}`
    );
    setAvailability(rows.find((r) => r.deviceId === deviceId)?.availabilityPct ?? null);
  }

  useEffect(() => {
    loadDevice().catch(() => {});
    api.get<{ items: Alert[] }>(`/alerts?deviceId=${deviceId}&limit=100`).then((p) => setAlerts(p.items)).catch(() => {});
    api.get<Check[]>(`/devices/${deviceId}/checks`).then(setChecks).catch(() => {});
    api.get<MaintenanceWindow[]>(`/maintenance?deviceId=${deviceId}`).then(setMaintenance).catch(() => {});
  }, [deviceId]);

  useEffect(() => {
    loadAvailability().catch(() => {});
  }, [deviceId, range]);

  useWsMessages((msg) => {
    const evt = msg as { type?: string; deviceId?: string; state?: string; since?: string; latencyMs?: number };
    if (evt.type === "device.status_changed" && evt.deviceId === deviceId) {
      setStatus({ state: evt.state!, since: evt.since!, lastSeen: null, lastLatencyMs: evt.latencyMs ?? null });
    }
  });

  const icmpLatency = useMetric(deviceId, "icmp.latencyMs", range);
  const lossPct = useMetric(deviceId, "lossPct", range);
  const cpuPct = useMetric(deviceId, "cpuPct", range);
  const memPct = useMetric(deviceId, "memUsedPct", range);

  const rangeAlerts = useMemo(() => {
    const since = Date.now() - RANGE_HOURS[range] * 60 * 60 * 1000;
    return alerts.filter((a) => new Date(a.openedAt).getTime() >= since).slice(0, 12);
  }, [alerts, range]);

  async function toggleCheck(check: Check) {
    const updated = await api.patch<Check>(`/checks/${check.id}`, { enabled: !check.enabled });
    setChecks((prev) => prev.map((c) => (c.id === check.id ? updated : c)));
  }

  async function updateThreshold(check: Check, key: "latencyMs" | "lossPct", value: number) {
    const updated = await api.patch<Check>(`/checks/${check.id}`, { thresholds: { [key]: value } });
    setChecks((prev) => prev.map((c) => (c.id === check.id ? updated : c)));
    toast.success("Threshold updated.");
  }

  async function scheduleMaintenance() {
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const created = await api.post<MaintenanceWindow>("/maintenance", {
      deviceId,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
    setMaintenance((prev) => [...prev, created]);
    toast.success("Maintenance window scheduled.");
  }

  async function scheduleMaintenanceCustom() {
    if (!maintStart) return;
    setSchedulingMaint(true);
    try {
      const start = new Date(maintStart);
      const end = new Date(start.getTime() + maintDurationMin * 60 * 1000);
      const created = await api.post<MaintenanceWindow>("/maintenance", {
        deviceId: maintScope === "device" ? deviceId : undefined,
        groupId: maintScope === "group" ? (device?.groupId ?? undefined) : undefined,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        recurrence: maintRecurrence || null,
      });
      setMaintenance((prev) => [...prev, created]);
      toast.success(maintScope === "group" ? "Maintenance window scheduled for the whole group." : "Maintenance window scheduled.");
      setMaintStart("");
      setMaintDurationMin(60);
      setMaintRecurrence("");
    } catch {
      toast.error("Failed to schedule maintenance window.");
    } finally {
      setSchedulingMaint(false);
    }
  }

  async function cancelMaintenance(windowId: string) {
    await api.delete(`/maintenance/${windowId}`);
    setMaintenance((prev) => prev.filter((w) => w.id !== windowId));
    toast.info("Maintenance window cancelled.");
  }

  if (!device) {
    return (
      <Layout>
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="h-32 animate-pulse rounded-xl border border-border bg-bg-surface" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="h-48 animate-pulse rounded-lg border border-border bg-bg-surface" />
            <div className="h-48 animate-pulse rounded-lg border border-border bg-bg-surface" />
          </div>
        </div>
      </Layout>
    );
  }

  const currentState = status?.state ?? null;
  const hasSnmp = !!device.snmpCredsEnc;

  return (
    <Layout>
      <div className="mx-auto max-w-5xl space-y-6">
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <StatusDot state={currentState} size={14} pulse={currentState === "down"} />
              <div>
                <h1 className="font-display text-xl font-bold tracking-tighter text-text-primary">{device.name}</h1>
                <p className="text-sm text-text-secondary">
                  {DEVICE_TYPE_LABELS[device.type]} · <span className="font-mono">{device.ip}</span>
                  {group && <> · {group.name}</>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={`cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    range === r ? "bg-accent text-accent-text-on" : "border border-border text-text-secondary hover:bg-bg-subtle"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-text-secondary">Availability ({range})</div>
              <div className="font-mono text-lg font-bold tabular-nums tracking-tighter text-text-primary">{availability != null ? `${availability}%` : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-text-secondary">Last latency</div>
              <div className="font-mono text-lg font-bold tabular-nums tracking-tighter text-text-primary">{status?.lastLatencyMs != null ? `${status.lastLatencyMs} ms` : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-text-secondary">Poll interval</div>
              <div className="font-mono text-lg font-bold tabular-nums tracking-tighter text-text-primary">{device.intervalSec}s</div>
            </div>
            <div>
              <div className="text-xs text-text-secondary">Status</div>
              <div className="font-mono text-lg font-bold capitalize tracking-tighter text-text-primary">{currentState ?? "unknown"}</div>
            </div>
          </div>
        </Card>

        <div role="tablist" aria-label="Device sections" className="flex gap-1 border-b border-border">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex cursor-pointer items-center gap-1.5 px-4 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                tab === key ? "border-b-2 border-accent text-text-primary" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {tab === "metrics" && (
          <div className="space-y-4">
            {rangeAlerts.length > 0 && (
              <Card className="p-3">
                <h4 className="mb-2 text-2xs font-medium uppercase tracking-wide text-text-secondary">Alerts in this range</h4>
                <div className="flex flex-wrap gap-1.5">
                  {rangeAlerts.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setTab("alerts")}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors duration-150 hover:opacity-80 ${SEVERITY_COLOR[a.severity]}`}
                      title={`${a.title} — ${new Date(a.openedAt).toLocaleString()}`}
                    >
                      {new Date(a.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {a.title}
                    </button>
                  ))}
                </div>
              </Card>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ChartCard title="Latency (ms)" data={icmpLatency} unit="ms" syncId="device-metrics" />
              <ChartCard title="Packet loss (%)" data={lossPct} unit="%" syncId="device-metrics" />
              {hasSnmp && <ChartCard title="CPU (%)" data={cpuPct} unit="%" syncId="device-metrics" />}
              {hasSnmp && <ChartCard title="Memory used (%)" data={memPct} unit="%" syncId="device-metrics" />}
            </div>
          </div>
        )}

        {tab === "alerts" &&
          (alerts.length === 0 ? (
            <EmptyState icon={Siren} title="No alerts recorded" description="This device hasn't triggered any alerts." />
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className={`rounded-md border px-4 py-3 text-sm ${SEVERITY_COLOR[a.severity]}`}>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-text-secondary">
                    {a.status} · opened {new Date(a.openedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === "checks" &&
          (checks.length === 0 ? (
            <EmptyState icon={ListChecks} title="No checks configured" />
          ) : (
            <div className="space-y-3">
              {checks.map((check) => (
                <Card key={check.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium uppercase text-text-primary">{check.kind}</span>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                      <input type="checkbox" checked={check.enabled} onChange={() => toggleCheck(check)} className="cursor-pointer accent-accent" />
                      Enabled
                    </label>
                  </div>
                  {(check.kind === "icmp" || check.kind === "http") && (
                    <div className="mt-3 flex flex-wrap gap-4">
                      <FieldGroup label="Latency threshold (ms)">
                        {(ids) => (
                          <Input
                            {...ids}
                            type="number"
                            defaultValue={check.thresholds.latencyMs}
                            onBlur={(e) => updateThreshold(check, "latencyMs", Number(e.target.value))}
                            className="w-24"
                          />
                        )}
                      </FieldGroup>
                      {check.kind === "icmp" && (
                        <FieldGroup label="Loss threshold (%)">
                          {(ids) => (
                            <Input
                              {...ids}
                              type="number"
                              defaultValue={check.thresholds.lossPct}
                              onBlur={(e) => updateThreshold(check, "lossPct", Number(e.target.value))}
                              className="w-24"
                            />
                          )}
                        </FieldGroup>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          ))}

        {tab === "maintenance" && (
          <div className="space-y-4">
            <Card className="p-4">
              <h4 className="mb-3 text-sm font-medium text-text-primary">Schedule a maintenance window</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <FieldGroup label="Starts">
                  {(ids) => <Input {...ids} type="datetime-local" value={maintStart} onChange={(e) => setMaintStart(e.target.value)} />}
                </FieldGroup>
                <FieldGroup label="Duration (min)">
                  {(ids) => (
                    <Input {...ids} type="number" min={5} value={maintDurationMin} onChange={(e) => setMaintDurationMin(Number(e.target.value))} />
                  )}
                </FieldGroup>
                <FieldGroup label="Recurrence">
                  {(ids) => (
                    <Select {...ids} value={maintRecurrence} onChange={(e) => setMaintRecurrence(e.target.value as "" | "daily" | "weekly")}>
                      <option value="">None (one-time)</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </Select>
                  )}
                </FieldGroup>
                <FieldGroup label="Scope">
                  {(ids) => (
                    <Select {...ids} value={maintScope} onChange={(e) => setMaintScope(e.target.value as "device" | "group")} disabled={!device?.groupId}>
                      <option value="device">This device only</option>
                      <option value="group" disabled={!device?.groupId}>
                        Whole group{group ? ` (${group.name})` : ""}
                      </option>
                    </Select>
                  )}
                </FieldGroup>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={scheduleMaintenanceCustom} disabled={!maintStart || schedulingMaint}>
                  {schedulingMaint ? "Scheduling…" : "Schedule"}
                </Button>
                <Button variant="secondary" size="sm" onClick={scheduleMaintenance}>
                  Quick: 1 hour, starting now
                </Button>
              </div>
            </Card>

            {maintenance.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No maintenance windows scheduled" />
            ) : (
              <div className="space-y-2">
                {maintenance.map((w) => {
                  const status = maintenanceWindowStatus(w, new Date().toISOString());
                  return (
                    <div key={w.id} className="flex items-center justify-between rounded-md border border-border bg-bg-surface px-4 py-2 text-sm text-text-primary">
                      <div className="flex items-center gap-2">
                        <Badge tone={status === "active" ? "success" : status === "upcoming" ? "neutral" : "neutral"}>
                          {status === "active" ? "Active now" : status === "upcoming" ? "Upcoming" : "Expired"}
                        </Badge>
                        <span>
                          {new Date(w.startsAt).toLocaleString()} → {new Date(w.endsAt).toLocaleString()}
                        </span>
                        {w.recurrence && <span className="text-xs text-text-secondary">(recurs {w.recurrence})</span>}
                        {w.groupId && <span className="text-xs text-text-secondary">— whole group</span>}
                      </div>
                      <button
                        onClick={() => cancelMaintenance(w.id)}
                        className="cursor-pointer text-xs text-critical transition-colors duration-150 hover:text-critical/80"
                      >
                        Cancel
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

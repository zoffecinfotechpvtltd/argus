import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, Cpu, MemoryStick, Users2, Cable } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import type { Device } from "../api/types";
import { EmptyState, SkeletonCards } from "../components/ui";
import { BentoCard } from "../components/charts/BentoCard";
import { StatusDot } from "../components/StatusDot";

// Same additive withStatus=true shape Inventory.tsx's DeviceRow and Dashboard.tsx consume.
type DeviceWithStatus = Device & { state?: string | null };

interface MetricPoint {
  ts: string;
  value: number;
}

// Dashboard-scale safeguard, same reasoning as Bandwidth.tsx's monitoredTargets cap — beyond this,
// per-device metric fan-out (5 requests each) stops being "load a page" and starts being "hammer
// the API"; a fleet that large wants a filtered/paged view, not a single dashboard screen.
const MAX_FIREWALLS = 30;

const METRIC_NAMES = ["cpuPct", "memUsedPct", "sessionCount", "vpnTunnelsUp", "vpnTunnelsTotal"] as const;
type MetricName = (typeof METRIC_NAMES)[number];

interface FirewallStats {
  device: DeviceWithStatus;
  metrics: Partial<Record<MetricName, number>>;
}

function latestValue(points: MetricPoint[]): number | undefined {
  return points.length > 0 ? points[points.length - 1]!.value : undefined;
}

function StatTile({ icon: Icon, label, value, valueClassName = "" }: { icon: typeof Cpu; label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle/50 px-2.5 py-1.5">
      <Icon size={14} className="shrink-0 text-text-secondary" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
        <div className={`truncate font-mono text-sm font-semibold tabular-nums text-text-primary ${valueClassName}`}>{value}</div>
      </div>
    </div>
  );
}

// Was previously computed but applied to the "no creds configured" hint text instead of the CPU/
// memory values it was clearly meant for — that hint renders as an empty string in the common
// case, so the color it was actually attached to was almost never visible at all.
function pctColor(pct: number | undefined): string {
  if (pct === undefined) return "";
  if (pct >= 90) return "text-critical";
  if (pct >= 75) return "text-warning";
  return "";
}

export function Firewalls() {
  const [stats, setStats] = useState<FirewallStats[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const page = await api.get<{ items: DeviceWithStatus[]; total: number }>("/devices?type=firewall&withStatus=true&limit=2000");
      const firewalls = page.items.slice(0, MAX_FIREWALLS);
      if (cancelled) return;
      setTruncated(page.items.length > MAX_FIREWALLS);

      const results = await Promise.all(
        firewalls.map(async (device) => {
          const entries = await Promise.all(
            METRIC_NAMES.map(async (name) => {
              const res = await api.get<{ points: MetricPoint[] }>(`/metrics/${device.id}?range=1h&name=${name}`).catch(() => ({ points: [] }));
              return [name, latestValue(res.points)] as const;
            })
          );
          const metrics: Partial<Record<MetricName, number>> = {};
          for (const [name, value] of entries) if (value !== undefined) metrics[name] = value;
          return { device, metrics };
        })
      );
      // Down-first, not the API's default (insertion order) — the point of a fleet-wide firewall
      // view is spotting what needs attention, and a down firewall buried alphabetically among
      // healthy ones defeats that.
      const STATE_RANK: Record<string, number> = { down: 0, flapping: 1, degraded: 2, maintenance: 3, up: 4 };
      results.sort((a, b) => (STATE_RANK[a.device.state ?? "up"] ?? 5) - (STATE_RANK[b.device.state ?? "up"] ?? 5));
      if (!cancelled) setStats(results);
    }

    load().catch(() => setStats([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Layout title="Firewalls" subtitle="Fleet-wide view of every firewall device — model, firmware, HA role, and live CPU/memory/session/VPN metrics">
      <div className="space-y-6">
        {stats === null ? (
          <SkeletonCards count={3} />
        ) : stats.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="No firewall devices yet"
            description="Add a device with type 'Firewall' in Inventory — CPU/memory/session/VPN metrics appear here once SNMP or a vendor API (FortiGate) is configured on it."
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {stats.map(({ device, metrics }) => {
              const noCredsConfigured = !device.snmpCredsEnc && !device.apiVendor;
              return (
                <BentoCard key={device.id} interactive className="p-4" onClick={() => navigate(`/devices/${device.id}`)}>
                  <div className="mb-2 flex items-center gap-2">
                    <StatusDot state={device.state ?? null} size={12} pulse={device.state === "down"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-text-primary">{device.name}</div>
                      <div className="truncate font-mono text-xs text-text-secondary">{device.ip}</div>
                    </div>
                    {device.apiVendor === "fortigate" && (
                      <span className="shrink-0 rounded-full bg-bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                        FortiGate API
                      </span>
                    )}
                  </div>

                  {(device.model || device.firmwareVersion || device.haRole) && (
                    <div className="mb-3 truncate text-xs text-text-secondary">
                      {device.model && device.model}
                      {device.firmwareVersion && <> · fw {device.firmwareVersion}</>}
                      {device.haRole && <> · HA {device.haRole}</>}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <StatTile
                      icon={Cpu}
                      label="CPU"
                      value={metrics.cpuPct !== undefined ? `${metrics.cpuPct.toFixed(0)}%` : "—"}
                      valueClassName={pctColor(metrics.cpuPct)}
                    />
                    <StatTile
                      icon={MemoryStick}
                      label="Memory"
                      value={metrics.memUsedPct !== undefined ? `${metrics.memUsedPct.toFixed(0)}%` : "—"}
                      valueClassName={pctColor(metrics.memUsedPct)}
                    />
                    <StatTile icon={Users2} label="Sessions" value={metrics.sessionCount !== undefined ? metrics.sessionCount.toLocaleString() : "—"} />
                    <StatTile
                      icon={Cable}
                      label="VPN tunnels"
                      value={metrics.vpnTunnelsTotal !== undefined ? `${metrics.vpnTunnelsUp ?? 0}/${metrics.vpnTunnelsTotal}` : "—"}
                    />
                  </div>
                  {noCredsConfigured && (
                    <div className="mt-2 text-right text-[10px] text-text-muted">no SNMP/API creds configured</div>
                  )}
                </BentoCard>
              );
            })}
          </motion.div>
        )}
        {truncated && (
          <p className="text-center text-xs text-text-secondary">
            Showing the first {MAX_FIREWALLS} firewalls — filter in Inventory to see the rest.
          </p>
        )}
      </div>
    </Layout>
  );
}

import { useEffect, useRef, useState } from "react";

type Status = "up" | "down" | "warn";

interface Row {
  id: string;
  name: string;
  ip: string;
  check: string;
  status: Status;
  latencyMs: number;
}

const STATUS_DOT: Record<Status, string> = {
  up: "bg-status-healthy shadow-[0_0_6px_rgb(var(--color-success)/0.8)]",
  warn: "bg-status-warning shadow-[0_0_6px_rgb(var(--color-warning)/0.8)]",
  down: "bg-status-critical shadow-[0_0_6px_rgb(var(--color-critical)/0.8)]",
};

const STATUS_TEXT: Record<Status, string> = {
  up: "text-status-healthy",
  warn: "text-status-warning",
  down: "text-status-critical",
};

const FULL_ROWS: Row[] = [
  { id: "rtr", name: "core-router-01", ip: "10.0.1.1", check: "ICMP", status: "up", latencyMs: 1.2 },
  { id: "fw", name: "edge-fw-02", ip: "10.0.1.2", check: "TCP:443", status: "up", latencyMs: 4.8 },
  { id: "sw", name: "dist-switch-04", ip: "10.0.2.1", check: "SNMP", status: "up", latencyMs: 2.1 },
  { id: "db", name: "db-primary", ip: "10.0.4.10", check: "TCP:5432", status: "down", latencyMs: 0 },
  { id: "app", name: "app-server-02", ip: "10.0.4.21", check: "HTTP:80", status: "up", latencyMs: 18.4 },
  { id: "ap", name: "wifi-ap-east", ip: "10.0.6.4", check: "ICMP", status: "warn", latencyMs: 61.5 },
];

const COMPACT_ROWS: Row[] = [
  { id: "rtr", name: "core-router-01", ip: "10.0.1.1", check: "ICMP", status: "up", latencyMs: 1.2 },
  { id: "db", name: "db-primary", ip: "10.0.4.10", check: "TCP:5432", status: "down", latencyMs: 0 },
  { id: "app", name: "app-server-02", ip: "10.0.4.21", check: "HTTP:80", status: "up", latencyMs: 18.4 },
];

function jitter(ms: number): number {
  const delta = (Math.random() - 0.5) * ms * 0.4;
  return Math.max(0.3, Math.round((ms + delta) * 10) / 10);
}

/** The site's one signature visual: a live-looking readout of the exact device rows Argus
 * actually renders (name, IP, protocol, latency) instead of a decorative node/particle graphic.
 * Latencies drift on an interval to read as "live"; one row stays down so the panel demonstrates
 * the product's own claim (you see precisely which device dropped) rather than illustrating it
 * abstractly. Respects prefers-reduced-motion by freezing the numbers. */
export function TelemetryPanel({ variant = "hero", className = "" }: { variant?: "hero" | "compact"; className?: string }) {
  const base = variant === "hero" ? FULL_ROWS : COMPACT_ROWS;
  const [rows, setRows] = useState<Row[]>(base);
  const tick = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const id = window.setInterval(() => {
      tick.current += 1;
      setRows((prev) =>
        prev.map((r) => (r.status === "down" ? r : { ...r, latencyMs: jitter(base.find((b) => b.id === r.id)?.latencyMs ?? r.latencyMs) }))
      );
    }, 1800);
    return () => window.clearInterval(id);
  }, [base]);

  const downCount = rows.filter((r) => r.status === "down").length;

  return (
    <div className={`overflow-hidden rounded-lg border border-border bg-surface ${className}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Live device checks</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-status-healthy" />
          scanning
        </span>
      </div>

      <div className="grid grid-cols-[16px_1fr_auto] gap-x-3 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-dim sm:grid-cols-[16px_1fr_88px_72px]">
        <span />
        <span>Device</span>
        <span className="hidden sm:block">Check</span>
        <span className="text-right">Latency</span>
      </div>

      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[16px_1fr_auto] items-center gap-x-3 px-4 py-2.5 sm:grid-cols-[16px_1fr_88px_72px]">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[r.status]}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-fog">{r.name}</span>
              <span className="block truncate font-mono text-[11px] text-dim">{r.ip}</span>
            </span>
            <span className="hidden font-mono text-[11px] text-dim sm:block">{r.check}</span>
            <span className={`text-right font-mono text-[12px] font-medium ${STATUS_TEXT[r.status]}`}>
              {r.status === "down" ? "timeout" : `${r.latencyMs.toFixed(1)}ms`}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-[10px] text-dim">
        <span>{rows.length} devices</span>
        <span className={downCount > 0 ? "text-status-critical" : ""}>{downCount} unreachable</span>
      </div>
    </div>
  );
}

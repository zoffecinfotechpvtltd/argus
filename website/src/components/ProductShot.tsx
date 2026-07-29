import { LayoutGrid, HardDrive, BellRing, FileBarChart, AlertTriangle } from "lucide-react";

const NAV = [
  { icon: LayoutGrid, label: "Dashboard", active: true },
  { icon: HardDrive, label: "Inventory", active: false },
  { icon: BellRing, label: "Alerts", active: false },
  { icon: FileBarChart, label: "Reports", active: false },
];

const DEVICES = [
  { name: "core-router-01", ip: "10.0.1.1", latency: "1.2ms", status: "up" as const },
  { name: "edge-fw-02", ip: "10.0.1.2", latency: "4.8ms", status: "up" as const },
  { name: "db-primary", ip: "10.0.4.10", latency: "—", status: "down" as const },
  { name: "app-server-02", ip: "10.0.4.21", latency: "18ms", status: "up" as const },
  { name: "switch-floor3", ip: "10.0.2.14", latency: "0.6ms", status: "up" as const },
  { name: "ap-lobby-02", ip: "10.0.3.40", latency: "3.1ms", status: "up" as const },
];

const DOT = { up: "bg-emerald-500", down: "bg-red-500" };

/** The page's one hero visual: a single, quiet product photo of the actual dashboard — window
 * chrome, a real nav, a real device list — rather than a recurring "live terminal" motif repeated
 * across every section. Apple's product pages do one confident hero shot, not a decorative
 * illustration; this is that shot for Argus.
 *
 * Deliberately theme-independent (literal gray/purple, not the fog/muted/border tokens): a
 * product screenshot should read the same whether the surrounding page is in light or dark mode —
 * exactly like Apple's own marketing pages never invert their screenshots — rather than going
 * illegible (near-white text on a white card) when the page switches to dark. */
export function ProductShot({ className = "" }: { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-soft-lg ${className}`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        </div>
        <span className="justify-self-center font-sans text-[12px] font-medium text-gray-400">Argus — Dashboard</span>
      </div>

      <div className="grid grid-cols-[150px_1fr]">
        <div className="hidden border-r border-gray-200 bg-gray-50 p-3 sm:block">
          {NAV.map((n) => (
            <div
              key={n.label}
              className={`mb-1 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium ${
                n.active ? "bg-violet-50 text-violet-600" : "text-gray-500"
              }`}
            >
              <n.icon size={15} strokeWidth={2} aria-hidden="true" />
              {n.label}
            </div>
          ))}
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Devices" value="128" />
            <Stat label="Uptime" value="99.98%" />
            <Stat label="Avg latency" value="6ms" />
            <Stat label="Open alerts" value="1" accent />
          </div>

          <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 text-red-500" aria-hidden="true" />
            <span className="text-[12.5px] font-medium text-gray-900">db-primary unreachable</span>
            <span className="ml-auto shrink-0 text-[11px] text-gray-400">Tier 1 notified · 2m ago</span>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200">
            {DEVICES.map((d, i) => (
              <div
                key={d.name}
                className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? "border-t border-gray-200" : ""}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[d.status]}`} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-gray-900">{d.name}</span>
                <span className="hidden font-mono text-[11px] text-gray-400 sm:block">{d.ip}</span>
                <span className={`w-12 shrink-0 text-right font-mono text-[11px] ${d.status === "down" ? "text-red-500" : "text-gray-500"}`}>
                  {d.latency}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-[15px] font-semibold ${accent ? "text-red-500" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}

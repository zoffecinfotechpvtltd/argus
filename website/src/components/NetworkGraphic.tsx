import { useEffect, useRef } from "react";
import { Router, ShieldCheck, Network, Server, Database, Monitor, type LucideIcon } from "lucide-react";

type Status = "healthy" | "warning" | "critical" | "info";

interface DeviceNode {
  id: string;
  icon: LucideIcon;
  label: string;
  x: number; // 0-480 viewBox units
  y: number; // 0-380 viewBox units
  status: Status;
}

interface Link {
  from: string;
  to: string;
}

const STATUS_COLOR: Record<Status, string> = {
  healthy: "#6fdb78",
  warning: "#f6b94a",
  critical: "#ef5b5b",
  info: "#48b7a7",
};

const FULL_NODES: DeviceNode[] = [
  { id: "router", icon: Router, label: "Core Router", x: 240, y: 42, status: "healthy" },
  { id: "firewall", icon: ShieldCheck, label: "Firewall", x: 240, y: 130, status: "healthy" },
  { id: "switch", icon: Network, label: "Switch", x: 240, y: 218, status: "healthy" },
  { id: "server", icon: Server, label: "App Server", x: 118, y: 320, status: "healthy" },
  { id: "database", icon: Database, label: "Database", x: 240, y: 320, status: "warning" },
  { id: "pc", icon: Monitor, label: "Workstations", x: 362, y: 320, status: "critical" },
];
const FULL_LINKS: Link[] = [
  { from: "router", to: "firewall" },
  { from: "firewall", to: "switch" },
  { from: "switch", to: "server" },
  { from: "switch", to: "database" },
  { from: "switch", to: "pc" },
];

const COMPACT_NODES: DeviceNode[] = [
  { id: "router", icon: Router, label: "Router", x: 240, y: 55, status: "healthy" },
  { id: "switch", icon: Network, label: "Switch", x: 240, y: 190, status: "healthy" },
  { id: "server", icon: Server, label: "Server", x: 130, y: 325, status: "warning" },
  { id: "pc", icon: Monitor, label: "Endpoints", x: 350, y: 325, status: "healthy" },
];
const COMPACT_LINKS: Link[] = [
  { from: "router", to: "switch" },
  { from: "switch", to: "server" },
  { from: "switch", to: "pc" },
];

/** A small, hand-laid-out network topology — real device roles (router, firewall, switch, server,
 * database, workstations) in a believable core→distribution→access layout, not a randomized
 * particle graph. Tilted via CSS perspective for depth; a pulse travels the links on a loop to
 * read as "live," and one node sits in a non-healthy state so the diagram itself demonstrates
 * what Argus catches. */
export function NetworkGraphic({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const nodes = compact ? COMPACT_NODES : FULL_NODES;
  const links = compact ? COMPACT_LINKS : FULL_LINKS;
  const pulseRefs = useRef<(SVGCircleElement | null)[]>([]);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const timers: number[] = [];
    links.forEach((link, i) => {
      const s = byId[link.from];
      const t = byId[link.to];
      const el = pulseRefs.current[i];
      if (!s || !t || !el) return;

      const fire = () => {
        const anim = el.animate(
          [
            { transform: `translate(${s.x}px, ${s.y}px)`, opacity: 0.95 },
            { transform: `translate(${t.x}px, ${t.y}px)`, opacity: 0 },
          ],
          { duration: 1100, easing: "ease-in-out" }
        );
        anim.onfinish = () => {
          el.style.opacity = "0";
        };
        timers.push(window.setTimeout(fire, 1400 + Math.random() * 2200));
      };
      timers.push(window.setTimeout(fire, 300 + i * 260));
    });

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [compact]);

  return (
    <div className={`select-none ${className}`} style={{ perspective: "1400px" }} aria-hidden="true">
      <div className="relative" style={{ transform: "rotateX(26deg) rotateZ(-5deg)", transformStyle: "preserve-3d" }}>
        <svg viewBox="0 0 480 380" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="link-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#4b535a" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          {links.map((l, i) => {
            const s = byId[l.from];
            const t = byId[l.to];
            if (!s || !t) return null;
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="url(#link-gradient)" strokeWidth="1.5" />;
          })}
          {links.map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                pulseRefs.current[i] = el;
              }}
              r="3.2"
              fill="#7C3AED"
              style={{ opacity: 0, filter: "drop-shadow(0 0 5px rgba(124,58,237,0.9))" }}
            />
          ))}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
            style={{ left: `${(n.x / 480) * 100}%`, top: `${(n.y / 380) * 100}%` }}
          >
            <div
              className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-border shadow-[0_10px_24px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]"
              style={{ background: "linear-gradient(155deg, #7C3AED 0%, #2D184E 100%)" }}
            >
              <n.icon size={19} strokeWidth={2} className="text-accent-text-on" aria-hidden="true" />
              <span
                className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-canvas"
                style={{ background: STATUS_COLOR[n.status], boxShadow: `0 0 6px ${STATUS_COLOR[n.status]}` }}
              />
            </div>
            <span className="whitespace-nowrap font-mono text-[9.5px] uppercase tracking-wide text-dim">{n.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

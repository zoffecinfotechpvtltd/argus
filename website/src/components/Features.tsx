import { Activity, Map, ServerCog } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

const QUICK_SPECS = [
  { icon: Activity, title: "Real checks", body: "ICMP, TCP, HTTP/HTTPS, and SNMP — the same engine, load-tested to 10,000 devices." },
  { icon: Map, title: "Topology & reports", body: "A live network map and downtime reports you can hand to a customer as proof of uptime." },
  { icon: ServerCog, title: "Runs itself", body: "Installs as a background Windows service — through logout, reboot, and long weekends." },
];

export function Features() {
  return (
    <section id="features" className="relative bg-canvas py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal className="mx-auto mb-20 max-w-xl text-center">
          <span className="text-sm font-medium text-accent">What you get</span>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-tight text-fog">
            Built to watch, not just to ping.
          </h2>
        </ScrollReveal>

        <div className="grid gap-24">
          <FeatureRow
            eyebrow="Discovery"
            title="Finds your network before you finish typing the subnet."
            body="Point it at 192.168.1.0/24. Argus sweeps it, guesses what every device is, and suggests the right checks — in seconds, not an afternoon of manual entry."
            visual={<DiscoveryVisual />}
          />
          <FeatureRow
            eyebrow="Alerting"
            reverse
            title="Never a single email that sits unread."
            body="The device owner is notified immediately, by name. If ten minutes pass with no acknowledgment, it works up the chain — Tier 1, then Tier 2 — until someone answers."
            visual={<EscalationVisual />}
          />
          <FeatureRow
            eyebrow="Privacy"
            title="Your data never leaves the building."
            body="Everything — inventory, history, alerts — lives in one local file next to the install. No account to create, no vendor cloud, nothing that can leak in someone else's breach."
            visual={<LocalDataVisual />}
          />
        </div>

        <ScrollReveal className="mt-24 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          {QUICK_SPECS.map((f) => (
            <div key={f.title} className="bg-canvas p-7">
              <f.icon size={20} strokeWidth={2} className="text-accent" aria-hidden="true" />
              <h3 className="mt-3.5 text-base font-semibold text-fog">{f.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}

function FeatureRow({
  eyebrow,
  title,
  body,
  visual,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className={`grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16 ${reverse ? "lg:[direction:rtl]" : ""}`}>
      <ScrollReveal className={reverse ? "lg:[direction:ltr]" : ""}>
        <span className="text-sm font-medium text-accent">{eyebrow}</span>
        <h3 className="mt-2.5 font-display text-[clamp(1.6rem,3vw,2.1rem)] font-bold tracking-tight text-fog">{title}</h3>
        <p className="mt-4 text-base leading-relaxed text-muted">{body}</p>
      </ScrollReveal>
      <ScrollReveal delay={0.1} className={reverse ? "lg:[direction:ltr]" : ""}>
        {visual}
      </ScrollReveal>
    </div>
  );
}

/* These three illustrations, like ProductShot, are deliberately theme-independent (literal
   gray/violet, not the fog/muted/border tokens) — small fixed "photos," not panels that should
   invert when the page switches to dark. Each is built to actually fill its frame with real
   supporting detail (labels, a legend, a short file list) rather than one small glyph floating in
   a lot of empty white — the emptiness read as unfinished at full-screen zoom on a large monitor. */

function DiscoveryVisual() {
  const found = [
    { x: 66, y: 46, label: "10.0.1.4" },
    { x: 152, y: 34, label: "10.0.1.9" },
    { x: 224, y: 76, label: "10.0.1.12" },
    { x: 96, y: 122, label: "10.0.1.7" },
    { x: 192, y: 140, label: "10.0.1.15" },
    { x: 252, y: 108, label: "10.0.1.3" },
  ];
  return (
    <div className="flex aspect-[4/3] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[13px] text-gray-500">Scanning 192.168.1.0/24</span>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600">6 found</span>
      </div>
      <svg viewBox="0 0 280 180" className="mx-auto h-[75%] w-full overflow-visible">
        {[24, 48, 72, 96].map((r) => (
          <circle key={r} cx="30" cy="90" r={r} fill="none" stroke="#EEF0F3" strokeWidth="1.5" />
        ))}
        <circle cx="30" cy="90" r="4" fill="#7C3AED" />
        {found.map((d, i) => (
          <g key={i}>
            <line x1="30" y1="90" x2={d.x} y2={d.y} stroke="#E5E7EB" strokeWidth="1" />
            <circle cx={d.x} cy={d.y} r="5" fill="#111827" opacity="0.8" />
            <text x={d.x + 10} y={d.y + 4} fontSize="10" fontFamily="ui-monospace, monospace" fill="#9CA3AF">
              {d.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function EscalationVisual() {
  const steps = [
    { label: "Owner", time: "0 min", active: false },
    { label: "Tier 1", time: "0 min", active: false },
    { label: "Tier 2", time: "10 min", active: true },
  ];
  return (
    <div className="flex aspect-[4/3] flex-col justify-center gap-6 rounded-2xl border border-gray-200 bg-white p-8 shadow-soft">
      <div className="flex items-center justify-center gap-4">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-2">
              <div
                className={`rounded-full px-5 py-2.5 text-sm font-semibold ${
                  s.active ? "bg-violet-600 text-white" : "border border-gray-200 text-gray-500"
                }`}
              >
                {s.label}
              </div>
              <span className="font-mono text-[11px] text-gray-400">{s.time}</span>
            </div>
            {i < steps.length - 1 && <div className="mb-6 h-px w-8 bg-gray-200" />}
          </div>
        ))}
      </div>
      <p className="text-center text-[13px] text-gray-400">db-primary unreachable &middot; unacknowledged for 10 minutes</p>
    </div>
  );
}

function LocalDataVisual() {
  const files = [
    { name: "devices.db", size: "2.1 MB" },
    { name: "metrics.db", size: "148 MB" },
    { name: "alerts.db", size: "6.4 MB" },
  ];
  return (
    <div className="flex aspect-[4/3] flex-col items-center justify-center gap-5 rounded-2xl border border-gray-200 bg-white p-8 shadow-soft">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <div className="w-full max-w-[220px] overflow-hidden rounded-lg border border-gray-200">
        {files.map((f, i) => (
          <div key={f.name} className={`flex items-center justify-between px-3.5 py-2.5 ${i > 0 ? "border-t border-gray-100" : ""}`}>
            <span className="font-mono text-[12.5px] text-gray-700">{f.name}</span>
            <span className="font-mono text-[11px] text-gray-400">{f.size}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-gray-400">C:\Program Files\Argus\data &middot; this machine only</p>
    </div>
  );
}

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
      <div className="mx-auto max-w-5xl px-6">
        <ScrollReveal className="mx-auto mb-20 max-w-xl text-center">
          <span className="text-[13px] font-medium text-accent">What you get</span>
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
            <div key={f.title} className="bg-canvas p-6">
              <f.icon size={18} strokeWidth={2} className="text-accent" aria-hidden="true" />
              <h3 className="mt-3 text-[14px] font-semibold text-fog">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{f.body}</p>
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
        <span className="text-[13px] font-medium text-accent">{eyebrow}</span>
        <h3 className="mt-2 font-display text-[clamp(1.5rem,3vw,2rem)] font-bold tracking-tight text-fog">{title}</h3>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{body}</p>
      </ScrollReveal>
      <ScrollReveal delay={0.1} className={reverse ? "lg:[direction:ltr]" : ""}>
        {visual}
      </ScrollReveal>
    </div>
  );
}

/* These three illustrations, like ProductShot, are deliberately theme-independent (literal
   gray/violet, not the fog/muted/border tokens) — small fixed "photos," not panels that should
   invert when the page switches to dark. */

function DiscoveryVisual() {
  const dots = [
    { x: 60, y: 40 }, { x: 140, y: 30 }, { x: 210, y: 70 }, { x: 90, y: 110 }, { x: 180, y: 130 }, { x: 240, y: 100 },
  ];
  return (
    <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-soft">
      <svg viewBox="0 0 280 180" className="h-3/4 w-3/4 overflow-visible">
        {[24, 48, 72].map((r) => (
          <circle key={r} cx="30" cy="90" r={r} fill="none" stroke="#E5E7EB" strokeWidth="1" />
        ))}
        <circle cx="30" cy="90" r="3" fill="#7C3AED" />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r="4" fill="#111827" opacity="0.75" />
        ))}
      </svg>
    </div>
  );
}

function EscalationVisual() {
  const steps = ["Owner", "Tier 1", "Tier 2"];
  return (
    <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-soft">
      <div className="flex items-center gap-3">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <div
              className={`rounded-full px-4 py-2 text-[13px] font-semibold ${
                i === steps.length - 1 ? "bg-violet-600 text-white" : "border border-gray-200 text-gray-500"
              }`}
            >
              {s}
            </div>
            {i < steps.length - 1 && <div className="h-px w-6 bg-gray-200" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function LocalDataVisual() {
  return (
    <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-soft">
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-5 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <p className="mt-3 font-mono text-[11px] text-gray-500">argus.sqlite</p>
        <p className="text-[11px] text-gray-400">this machine only</p>
      </div>
    </div>
  );
}

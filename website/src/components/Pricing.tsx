import { Check } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

export interface PlanTier {
  key: string;
  label: string;
  range: string;
  blurb: string;
  popular?: boolean;
}

const TIERS: PlanTier[] = [
  { key: "starter", label: "Starter", range: "1–25 devices", blurb: "A branch office or small site." },
  { key: "professional", label: "Professional", range: "26–100 devices", blurb: "A growing IT team, one main site." },
  { key: "business", label: "Business", range: "101–500 devices", blurb: "Multi-site operations.", popular: true },
  { key: "enterprise", label: "Enterprise", range: "501–2,000 devices", blurb: "Large infrastructure, one license." },
  { key: "unlimited", label: "Unlimited", range: "2,001+ devices", blurb: "MSSPs and very large estates." },
];

const INCLUDED = [
  "Automatic discovery",
  "ICMP, TCP, HTTP/HTTPS, SNMP checks",
  "Tiered alert escalation",
  "Topology map, reports, SLA history",
  "Background Windows service",
  "Local-only data, no cloud dependency",
];

export function Pricing({ onSelectPlan }: { onSelectPlan: (plan: string) => void }) {
  return (
    <section id="pricing" className="relative bg-canvas py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal className="mx-auto mb-4 max-w-2xl text-center">
          <span className="font-display text-xs font-bold uppercase tracking-[0.16em] text-accent">Pricing</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">One product, licensed by device count.</h2>
          <p className="mt-3 text-muted">
            Every tier ships the exact same feature set — nothing is gated behind a higher plan. The only thing that changes is
            how many devices your license allows. Sold directly, no self-serve checkout: tell us your device count and we'll
            quote it.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {TIERS.map((t, i) => (
            <ScrollReveal key={t.key} delay={i * 0.06}>
              <div
                className={`flex h-full flex-col rounded-2xl border p-5 backdrop-blur-xl transition-transform hover:-translate-y-1 ${
                  t.popular ? "border-accent/60 bg-accent/[0.06] shadow-accent" : "border-border bg-surface/50 hover:border-fog/20"
                }`}
              >
                {t.popular && (
                  <span className="mb-3 inline-block w-fit rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-accent-text-on">
                    Most common
                  </span>
                )}
                <h3 className="font-display text-lg font-bold text-fog">{t.label}</h3>
                <p className={`mt-1 font-mono text-sm ${t.popular ? "text-accent" : "text-accent-secondary"}`}>{t.range}</p>
                <p className="mt-2 text-[13px] text-muted">{t.blurb}</p>
                <button
                  onClick={() => onSelectPlan(t.label)}
                  className={`mt-5 cursor-pointer rounded-lg px-4 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 ${
                    t.popular ? "bg-accent text-accent-text-on" : "border border-border text-fog hover:border-accent/40"
                  }`}
                >
                  Contact sales
                </button>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={0.2} className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border bg-surface/50 p-6 backdrop-blur-xl">
          <p className="mb-3 font-display text-sm font-bold text-fog">Included in every tier</p>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13.5px] text-muted">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-dim">
            Trial mode monitors up to 5 devices, free, with no time limit — install and try it before you talk to us.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}

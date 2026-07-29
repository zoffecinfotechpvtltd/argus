import { Building, Building2, Check, Globe2, Home, Landmark } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

export interface PlanTier {
  key: string;
  label: string;
  range: string;
  blurb: string;
  popular?: boolean;
}

const TIERS: (PlanTier & { icon: typeof Home })[] = [
  { key: "starter", label: "Starter", range: "1–25 devices", blurb: "A branch office or small site.", icon: Home },
  { key: "professional", label: "Professional", range: "26–100 devices", blurb: "A growing IT team, one main site.", icon: Building },
  { key: "business", label: "Business", range: "101–500 devices", blurb: "Multi-site operations.", popular: true, icon: Building2 },
  { key: "enterprise", label: "Enterprise", range: "501–2,000 devices", blurb: "Large infrastructure, one license.", icon: Landmark },
  { key: "unlimited", label: "Unlimited", range: "2,001+ devices", blurb: "MSSPs and very large estates.", icon: Globe2 },
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
    <section id="pricing" className="relative bg-surface py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal className="mx-auto mb-16 max-w-xl text-center">
          <span className="text-sm font-medium text-accent">Pricing</span>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-tight text-fog">
            One product, licensed by device count.
          </h2>
          <p className="mt-4 text-base text-muted">
            Every tier ships the exact same feature set — nothing gated behind a higher plan. Sold directly, no
            self-serve checkout: tell us your device count and we'll quote it.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-5 sm:divide-x sm:divide-y-0">
          {TIERS.map((t, i) => (
            <ScrollReveal key={t.key} delay={i * 0.05}>
              <div className="flex h-full flex-col px-6 py-10 text-center">
                {t.popular ? (
                  <span className="mx-auto mb-4 w-fit rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-text-on">
                    Most common
                  </span>
                ) : (
                  <span className="mb-4 h-[21px]" />
                )}
                <t.icon size={22} strokeWidth={1.75} className="mx-auto text-accent" aria-hidden="true" />
                <h3 className="mt-4 font-display text-lg font-bold text-fog">{t.label}</h3>
                <p className="mt-1.5 font-mono text-sm text-accent">{t.range}</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{t.blurb}</p>
                <button
                  onClick={() => onSelectPlan(t.label)}
                  className="mt-6 cursor-pointer rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-fog transition-colors hover:border-dim"
                >
                  Contact sales
                </button>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={0.2} className="mx-auto mt-14 max-w-2xl text-center">
          <p className="mb-6 text-sm font-semibold uppercase tracking-wide text-dim">Included in every tier</p>
          <ul className="mx-auto grid max-w-lg grid-cols-1 gap-x-8 gap-y-3.5 text-left sm:grid-cols-2">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[15px] text-muted">
                <Check size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-7 text-sm text-dim">
            Trial mode monitors up to 5 devices, free, with no time limit.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}

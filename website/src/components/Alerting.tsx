import { ArrowRight } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";
import { NetworkGraphic } from "./NetworkGraphic";

const TIERS = [
  { label: "Tier 1", delay: "0–10 min", desc: "Device owner, then the first on-call contact." },
  { label: "Tier 2", delay: "10–30 min", desc: "Team lead — only reached if Tier 1 hasn't acknowledged." },
  { label: "Tier 3", delay: "30+ min", desc: "Admin or NOC manager — the last resort for a still-open alert." },
];

export function Alerting() {
  return (
    <section id="alerting" className="relative overflow-hidden bg-canvas py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal className="mx-auto mb-14 max-w-2xl text-center">
          <span className="font-display text-xs font-bold uppercase tracking-[0.16em] text-accent">Intelligent alerting</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">A tiered chain, not a single ignored email.</h2>
          <p className="mt-3 text-muted">
            Assign a device group's escalation chain once — Argus notifies the device owner immediately, then works down the
            tiers on your schedule, stopping the moment someone acknowledges.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch lg:flex-col">
            {TIERS.map((t, i) => (
              <ScrollReveal key={t.label} delay={i * 0.1} className="flex flex-1 items-center gap-4">
                <div className="flex-1 rounded-xl border border-border bg-surface/50 p-5 backdrop-blur-xl transition-colors hover:border-accent/30">
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">{t.label}</div>
                  <div className="mt-1.5 font-display text-2xl font-bold text-fog">{t.delay}</div>
                  <div className="mt-1.5 text-[13px] text-muted">{t.desc}</div>
                </div>
                {i < TIERS.length - 1 && <ArrowRight size={20} className="hidden shrink-0 text-dim lg:block" aria-hidden="true" />}
              </ScrollReveal>
            ))}
          </div>

          <ScrollReveal
            delay={0.15}
            className="relative mx-auto aspect-[480/380] w-full max-w-md rounded-2xl border border-border bg-surface/50 p-4 backdrop-blur-xl"
          >
            <NetworkGraphic compact className="h-full w-full" />
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

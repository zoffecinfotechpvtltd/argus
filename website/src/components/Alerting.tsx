import { ScrollReveal } from "./ScrollReveal";

const TIERS = [
  { label: "Tier 1", delay: "0–10 min", desc: "Device owner, then the first on-call contact." },
  { label: "Tier 2", delay: "10–30 min", desc: "Team lead — only reached if Tier 1 hasn't acknowledged." },
  { label: "Tier 3", delay: "30+ min", desc: "Admin or NOC manager — the last resort for a still-open alert." },
];

export function Alerting() {
  return (
    <section id="alerting" className="relative bg-canvas py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-6">
        <ScrollReveal className="mx-auto mb-16 max-w-xl text-center">
          <span className="text-[13px] font-medium text-accent">Intelligent alerting</span>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-tight text-fog">
            A tiered chain, not a single ignored email.
          </h2>
          <p className="mt-4 text-[15px] text-muted">
            Assign a device group's escalation chain once — Argus notifies the owner immediately, then works down the
            tiers on your schedule, stopping the moment someone acknowledges.
          </p>
        </ScrollReveal>

        <div className="divide-y divide-border rounded-2xl border border-border">
          {TIERS.map((t, i) => (
            <ScrollReveal key={t.label} delay={i * 0.08}>
              <div className="flex items-center gap-6 px-6 py-6">
                <span className="font-display text-2xl font-bold tracking-tight text-accent">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-[15px] font-bold text-fog">{t.label}</span>
                    <span className="font-mono text-[12px] text-dim">{t.delay}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] text-muted">{t.desc}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

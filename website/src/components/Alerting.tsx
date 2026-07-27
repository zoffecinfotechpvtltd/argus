import { ScrollReveal } from "./ScrollReveal";
import { TelemetryPanel } from "./TelemetryPanel";

const TIERS = [
  { label: "Tier 1", delay: "0–10 min", desc: "Device owner, then the first on-call contact." },
  { label: "Tier 2", delay: "10–30 min", desc: "Team lead — only reached if Tier 1 hasn't acknowledged." },
  { label: "Tier 3", delay: "30+ min", desc: "Admin or NOC manager — the last resort for a still-open alert." },
];

export function Alerting() {
  return (
    <section id="alerting" className="relative bg-canvas py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal className="mx-auto mb-14 max-w-2xl text-center">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-accent">Intelligent alerting</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">A tiered chain, not a single ignored email.</h2>
          <p className="mt-3 text-muted">
            Assign a device group's escalation chain once — Argus notifies the device owner immediately, then works down the
            tiers on your schedule, stopping the moment someone acknowledges.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
          <ol className="grid gap-3">
            {TIERS.map((t, i) => (
              <ScrollReveal key={t.label} delay={i * 0.1}>
                <li className="grid grid-cols-[auto_1fr] items-center gap-4 rounded-lg border border-border bg-surface p-5">
                  <div className="font-mono text-2xl font-bold text-accent">{String(i + 1).padStart(2, "0")}</div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-sm font-bold text-fog">{t.label}</span>
                      <span className="font-mono text-xs text-dim">{t.delay}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{t.desc}</p>
                  </div>
                </li>
              </ScrollReveal>
            ))}
          </ol>

          <ScrollReveal delay={0.15} className="mx-auto w-full max-w-md">
            <TelemetryPanel variant="compact" />
            <p className="mt-3 text-center font-mono text-[11px] text-dim">
              db-primary unreachable → Tier 1 notified at 0m → Tier 2 at 10m if still open
            </p>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

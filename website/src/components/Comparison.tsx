import { XCircle, CheckCircle2 } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

const WITHOUT = [
  { time: "03:14", text: "db-primary drops. Nobody's watching — first sign of trouble is a support ticket." },
  { time: "03:52", text: "A customer calls. Someone finally opens a terminal and starts guessing which box is down." },
  { time: "04:20", text: "Root cause found, by hand. 66 minutes of unplanned downtime, no record of any of it." },
];

const WITH = [
  { time: "03:14", text: "db-primary misses 3 consecutive TCP:5432 checks. Argus opens an alert." },
  { time: "03:15", text: "Device owner is emailed immediately, by name — not \"something's wrong somewhere.\"" },
  { time: "03:26", text: "Unacknowledged after 10 minutes → Tier 2 is paged. Acked, fixed, logged in the uptime report." },
];

export function Comparison() {
  return (
    <section className="relative bg-canvas py-24">
      <div className="mx-auto max-w-5xl px-6">
        <ScrollReveal className="mx-auto mb-14 max-w-2xl text-center">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-accent">The difference</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">Same outage. Two timelines.</h2>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ScrollReveal className="rounded-lg border border-border bg-surface p-6">
            <div className="mb-5 flex items-center gap-2">
              <XCircle size={17} className="text-status-critical" aria-hidden="true" />
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-dim">Without Argus</h3>
            </div>
            <ol className="grid gap-4">
              {WITHOUT.map((r) => (
                <li key={r.time} className="grid grid-cols-[52px_1fr] gap-3">
                  <span className="font-mono text-xs text-dim">{r.time}</span>
                  <span className="text-[13.5px] leading-relaxed text-muted">{r.text}</span>
                </li>
              ))}
            </ol>
          </ScrollReveal>

          <ScrollReveal delay={0.1} className="rounded-lg border border-accent/40 bg-surface p-6">
            <div className="mb-5 flex items-center gap-2">
              <CheckCircle2 size={17} className="text-accent" aria-hidden="true" />
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-fog">With Argus</h3>
            </div>
            <ol className="grid gap-4">
              {WITH.map((r) => (
                <li key={r.time} className="grid grid-cols-[52px_1fr] gap-3">
                  <span className="font-mono text-xs text-accent">{r.time}</span>
                  <span className="text-[13.5px] leading-relaxed text-fog">{r.text}</span>
                </li>
              ))}
            </ol>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

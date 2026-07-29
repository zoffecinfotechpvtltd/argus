import { ScrollReveal } from "./ScrollReveal";

const WITHOUT = [
  { time: "03:14", text: "db-primary drops. Nobody's watching — first sign of trouble is a support ticket." },
  { time: "03:52", text: "A customer calls. Someone finally opens a terminal and starts guessing which box is down." },
  { time: "04:20", text: "Root cause found, by hand. 66 minutes of unplanned downtime, no record of any of it." },
];

const WITH = [
  { time: "03:14", text: "db-primary misses 3 consecutive checks. Argus opens an alert." },
  { time: "03:15", text: "Device owner is emailed immediately, by name — not \"something's wrong somewhere.\"" },
  { time: "03:26", text: "Unacknowledged after 10 minutes → Tier 2 is paged. Acked, fixed, logged in the uptime report." },
];

export function Comparison() {
  return (
    <section className="relative bg-surface py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <ScrollReveal className="mx-auto mb-16 max-w-xl text-center">
          <span className="text-[13px] font-medium text-accent">The difference</span>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-tight text-fog">
            Same outage. Two timelines.
          </h2>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-2">
          <ScrollReveal className="bg-surface p-8">
            <h3 className="mb-6 text-[12px] font-semibold uppercase tracking-wide text-dim">Without Argus</h3>
            <ol className="grid gap-5">
              {WITHOUT.map((r) => (
                <li key={r.time} className="grid grid-cols-[48px_1fr] gap-3">
                  <span className="font-mono text-[12px] text-dim">{r.time}</span>
                  <span className="text-[13.5px] leading-relaxed text-muted">{r.text}</span>
                </li>
              ))}
            </ol>
          </ScrollReveal>

          <ScrollReveal delay={0.1} className="bg-accent-subtle p-8">
            <h3 className="mb-6 text-[12px] font-semibold uppercase tracking-wide text-accent">With Argus</h3>
            <ol className="grid gap-5">
              {WITH.map((r) => (
                <li key={r.time} className="grid grid-cols-[48px_1fr] gap-3">
                  <span className="font-mono text-[12px] text-accent">{r.time}</span>
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

import { ScrollReveal } from "./ScrollReveal";

const STEPS = [
  {
    title: "Install & forget",
    body: "Run the setup wizard once. Argus installs as a background Windows service and starts monitoring immediately.",
    snippet: "Argus-Setup-v0.3.2-win-x64.exe",
  },
  {
    title: "Scan your subnet",
    body: "Your browser opens automatically. Discovery finds every device in seconds, classifies it, and suggests what to monitor.",
    snippet: "discovery scan 192.168.1.0/24",
  },
  {
    title: "Get out of the way",
    body: "Argus watches continuously, 24/7, and escalates through your team the instant something needs attention.",
    snippet: "6 devices · 0 alerts open",
  },
];

export function HowItWorks() {
  return (
    <section className="relative bg-canvas py-24">
      <div className="mx-auto max-w-3xl px-6">
        <ScrollReveal className="mb-16 text-center">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-accent">How it works</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">Watching your network in three steps.</h2>
        </ScrollReveal>

        <ol className="relative grid gap-8">
          <div className="absolute bottom-6 left-[19px] top-6 w-px bg-border" aria-hidden="true" />
          {STEPS.map((s, i) => (
            <ScrollReveal key={s.title} delay={i * 0.1}>
              <li className="relative grid grid-cols-[40px_1fr] items-start gap-5">
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-accent/50 bg-canvas font-mono text-sm font-bold text-accent">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-display text-base font-bold text-fog">{s.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{s.body}</p>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[12px] text-dim">
                    <span className="text-accent">$</span>
                    {s.snippet}
                  </div>
                </div>
              </li>
            </ScrollReveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

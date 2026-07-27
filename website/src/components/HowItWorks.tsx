import { ScrollReveal } from "./ScrollReveal";

const STEPS = [
  { title: "Install & forget", body: "Run the setup wizard once. Argus installs as a background Windows service and starts monitoring immediately." },
  { title: "Scan your subnet", body: "Your browser opens automatically. Discovery finds every device in seconds and suggests what to monitor." },
  { title: "Get out of the way", body: "Argus watches continuously and escalates through your team the instant something needs attention." },
];

export function HowItWorks() {
  return (
    <section className="relative bg-canvas py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <ScrollReveal className="mx-auto mb-20 max-w-xl text-center">
          <span className="text-[13px] font-medium text-accent">How it works</span>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-tight text-fog">
            Watching your network in three steps.
          </h2>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-16 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <ScrollReveal key={s.title} delay={i * 0.1}>
              <div className="relative">
                <span
                  className="pointer-events-none absolute -left-2 -top-10 select-none font-display text-[6rem] font-bold leading-none text-fog/[0.06]"
                  aria-hidden="true"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="relative font-display text-lg font-bold tracking-tight text-fog">{s.title}</h3>
                <p className="relative mt-2.5 text-[14.5px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

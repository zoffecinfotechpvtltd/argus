import { Download, Radar, Eye } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

const STEPS = [
  { icon: Download, title: "Install & forget", body: "Run the setup wizard once. Argus installs as a background Windows service and starts monitoring immediately." },
  { icon: Radar, title: "Scan your subnet", body: "Your browser opens automatically. Discovery finds every device in seconds, classifies it, and suggests what to monitor." },
  { icon: Eye, title: "Get out of the way", body: "Argus watches continuously, 24/7, and escalates through your team the instant something needs attention." },
];

export function HowItWorks() {
  return (
    <section className="relative bg-canvas py-24">
      <div className="mx-auto max-w-3xl px-6">
        <ScrollReveal className="mb-16 text-center">
          <span className="font-display text-xs font-bold uppercase tracking-[0.16em] text-accent">How it works</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">Watching your network in three steps.</h2>
        </ScrollReveal>

        <ol className="relative grid gap-10">
          <div className="absolute bottom-6 left-[27px] top-6 w-px bg-gradient-to-b from-accent/50 via-border to-transparent" aria-hidden="true" />
          {STEPS.map((s, i) => (
            <ScrollReveal key={s.title} delay={i * 0.12}>
              <li className="relative grid grid-cols-[56px_1fr] items-start gap-5">
                <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface/60 text-accent shadow-[0_0_0_1px_rgb(124_58_237/0.15),0_16px_32px_-16px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                  <s.icon size={22} strokeWidth={2} aria-hidden="true" />
                  <span className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent font-display text-[11px] font-bold text-accent-text-on">
                    {i + 1}
                  </span>
                </span>
                <div className="pt-2">
                  <h3 className="font-display text-base font-bold text-fog">{s.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            </ScrollReveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

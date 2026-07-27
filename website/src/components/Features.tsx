import { Radar, Activity, BellRing, Map, HardDrive, ServerCog } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

const FEATURES = [
  {
    icon: Radar,
    title: "Automatic discovery",
    body: "Point it at a subnet. It finds every device, guesses what it is, and suggests the right checks — in seconds.",
    big: true,
  },
  {
    icon: Activity,
    title: "Real checks, not just pings",
    body: "ICMP, TCP, HTTP/HTTPS, and SNMP — the same engine, load-tested to 10,000 devices.",
    big: true,
  },
  { icon: BellRing, title: "Alerts that escalate", body: "Email or webhook the instant something drops — then a tiered chain of your team, in order, until someone acknowledges." },
  { icon: Map, title: "Topology, reports, SLA history", body: "A live network map, historical uptime rollups, and downtime reports per device or group." },
  { icon: HardDrive, title: "Your data stays yours", body: "Everything lives in one local file. No account, no cloud, nothing to leak." },
  { icon: ServerCog, title: "Runs itself, 24/7", body: "Installs as a background Windows service — no console window, keeps watching through logout and reboot." },
];

export function Features() {
  return (
    <section id="features" className="relative bg-canvas py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal className="mx-auto mb-14 max-w-2xl text-center">
          <span className="font-display text-xs font-bold uppercase tracking-[0.16em] text-accent">What you get</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">Built to watch, not just to ping.</h2>
          <p className="mt-3 text-muted">Everything a real monitoring engine needs — none of the setup a real monitoring engine usually demands.</p>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <ScrollReveal key={f.title} delay={(i % 3) * 0.08} className={f.big ? "lg:row-span-1 lg:col-span-1" : ""}>
              <div className="group relative h-full cursor-default overflow-hidden rounded-2xl border border-border bg-surface/50 p-6 backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-accent/30 hover:bg-surface/70">
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: "#7C3AED" }}
                  aria-hidden="true"
                />
                <div className="relative mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-gradient-to-br from-accent-secondary/25 to-accent/25 text-accent">
                  <f.icon size={20} strokeWidth={2} aria-hidden="true" />
                </div>
                <h3 className="relative font-display text-[15.5px] font-bold text-fog">{f.title}</h3>
                <p className="relative mt-2 text-[13.8px] leading-relaxed text-muted">{f.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

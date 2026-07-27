import { Radar, Activity, BellRing, Map, HardDrive, ServerCog } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

const FEATURES = [
  {
    icon: Radar,
    title: "Automatic discovery",
    body: "Point it at a subnet. It finds every device, guesses what it is, and suggests the right checks — in seconds.",
  },
  {
    icon: Activity,
    title: "Real checks, not just pings",
    body: "Tests that the thing actually works, not just that it responds — ICMP, TCP, HTTP/HTTPS, and SNMP, load-tested to 10,000 devices.",
  },
  { icon: BellRing, title: "Alerts that escalate", body: "Never a single email that sits unread. It emails or messages the right person immediately, then works up your team in order until someone answers." },
  { icon: Map, title: "Topology, reports, SLA history", body: "See your whole network on one map, and prove your uptime with a real report — per device or per site." },
  { icon: HardDrive, title: "Your data stays yours", body: "Everything lives in one file, on your machine. No account to create, no vendor cloud, nothing that can leak in someone else's breach." },
  { icon: ServerCog, title: "Runs itself, 24/7", body: "Install it once and forget it exists — it keeps watching in the background through reboots, logouts, and long weekends." },
];

export function Features() {
  return (
    <section id="features" className="relative bg-canvas py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal className="mx-auto mb-14 max-w-2xl text-center">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-accent">What you get</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">Built to watch, not just to ping.</h2>
          <p className="mt-3 text-muted">Everything a real monitoring engine needs — none of the setup a real monitoring engine usually demands.</p>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <ScrollReveal key={f.title} delay={(i % 3) * 0.06}>
              <div className="group relative h-full cursor-default border-l-2 border-l-transparent bg-surface p-6 transition-colors hover:border-l-accent">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-border text-accent">
                  <f.icon size={18} strokeWidth={2} aria-hidden="true" />
                </div>
                <h3 className="font-display text-[15px] font-bold text-fog">{f.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{f.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

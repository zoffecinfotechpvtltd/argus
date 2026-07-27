import { useState } from "react";
import { Plus } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";

const FAQS = [
  { q: "Does Argus need an account or an internet connection?", a: "No. Setup creates a local admin account on your machine only. Monitoring, discovery, dashboards, and alerting all run without any outbound connection — the only optional network calls are checking for a license or a software update, both of which you control." },
  { q: "Where does my data go?", a: "Nowhere. Device inventory, metrics history, and alerts are stored in a local SQLite database next to the installation. Nothing is uploaded to a third party." },
  { q: "Does it keep running if I close the window or log out?", a: "Yes. The installer registers Argus as a Windows service that starts automatically on boot and keeps running in the background — there's no window to accidentally close." },
  { q: "What's free, and what needs a license?", a: "Trial mode monitors up to 5 devices with no time limit. Paid licenses raise that device cap in named tiers (Starter through Unlimited) and are issued after a direct purchase." },
  { q: "What exactly does it monitor?", a: "ICMP ping, TCP port checks, HTTP/HTTPS, and SNMP — against routers, switches, servers, access points, and anything else with an IP address, on the poll interval you set per device." },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="relative bg-canvas py-24 sm:py-32">
      <div className="mx-auto max-w-2xl px-6">
        <ScrollReveal className="mb-14 text-center">
          <span className="text-[13px] font-medium text-accent">FAQ</span>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-tight text-fog">Before you install.</h2>
        </ScrollReveal>

        <div className="divide-y divide-border border-y border-border">
          {FAQS.map((f, i) => {
            const expanded = open === i;
            return (
              <ScrollReveal key={f.q} delay={i * 0.04}>
                <div>
                  <button
                    onClick={() => setOpen(expanded ? null : i)}
                    aria-expanded={expanded}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left"
                  >
                    <h3 className="text-[15px] font-medium text-fog">{f.q}</h3>
                    <Plus
                      size={16}
                      className={`shrink-0 text-dim transition-transform duration-200 ${expanded ? "rotate-45 text-accent" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-300 ease-out"
                    style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <p className="pb-5 text-[14px] leading-relaxed text-muted">{f.a}</p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

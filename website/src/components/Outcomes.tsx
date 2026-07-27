import { ScrollReveal } from "./ScrollReveal";

const OUTCOMES = [
  { stat: "Minutes, not days", body: "You find out the moment something breaks — not from an angry phone call after it's already cost you a customer." },
  { stat: "One flat price", body: "License once by device count. No per-seat SaaS bill that quietly grows every month you're not looking." },
  { stat: "Nothing to hack", body: "No cloud account, no exposed login for an attacker to find. It runs on a computer you already own." },
];

/** Plain-language translation layer, sitting right after the hero: the hero and feature copy
 * below both lean on protocol names (ICMP/SNMP/TCP) because that's genuinely how IT evaluates
 * this — but whoever signs the purchase order doesn't need to know what SNMP is. This strip says
 * the same claims in outcome terms before the technical detail resumes. */
export function Outcomes() {
  return (
    <section className="border-y border-border bg-canvas py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {OUTCOMES.map((o, i) => (
            <ScrollReveal key={o.stat} delay={i * 0.08}>
              <p className="font-display text-xl font-bold text-fog">{o.stat}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{o.body}</p>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

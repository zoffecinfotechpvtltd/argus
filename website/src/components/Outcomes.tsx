import { ScrollReveal } from "./ScrollReveal";

const OUTCOMES = [
  { stat: "Minutes, not days", body: "You find out the moment something breaks — not from an angry phone call after it's already cost you a customer." },
  { stat: "One flat price", body: "License once by device count. No per-seat SaaS bill that quietly grows every month you're not looking." },
  { stat: "Nothing to hack", body: "No cloud account, no exposed login for an attacker to find. It runs on a computer you already own." },
];

/** Plain-language translation, right after the hero: everything else on this page leans on
 * protocol names because that's genuinely how IT evaluates this — but whoever signs the purchase
 * order doesn't need to know what SNMP is. This says the same claims in outcome terms. */
export function Outcomes() {
  return (
    <section className="bg-canvas py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {OUTCOMES.map((o, i) => (
            <ScrollReveal key={o.stat} delay={i * 0.08} className="py-8 first:pt-0 sm:px-10 sm:py-0 sm:first:pl-0 sm:last:pr-0">
              <p className="font-display text-lg font-bold tracking-tight text-fog">{o.stat}</p>
              <p className="mt-2 text-base leading-relaxed text-muted">{o.body}</p>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

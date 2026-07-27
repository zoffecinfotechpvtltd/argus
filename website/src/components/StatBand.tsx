import { ScrollReveal } from "./ScrollReveal";

const STATS = [
  { value: "10,000", label: "devices load-tested" },
  { value: "<2s", label: "to discover a subnet" },
  { value: "24/7", label: "background monitoring" },
];

export function StatBand() {
  return (
    <section className="bg-accent-subtle py-16">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-1 gap-10 text-center sm:grid-cols-3">
          {STATS.map((s, i) => (
            <ScrollReveal key={s.label} delay={i * 0.08}>
              <div className="font-display text-[clamp(2.2rem,5vw,3.2rem)] font-bold tracking-tight text-accent">{s.value}</div>
              <div className="mt-1 text-[14px] text-muted">{s.label}</div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

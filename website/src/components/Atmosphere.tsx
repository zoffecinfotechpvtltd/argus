/**
 * Full-bleed background layer for the hero: a faint dot grid plus two soft accent-colored glows,
 * with a large, very quiet version of the brand mark's own pulse-line drawn across the width.
 * This is the fix for "too much blank white space on wide screens" — rather than just widening the
 * text column (which would hurt readability at 2500px+), the negative space on either side of the
 * narrow hero copy gets filled with something that's actually *about* Argus: a signal line, same
 * shape as the mark's pulse through the "A", stretched out as ambient texture. Nothing here is
 * interactive or announced to assistive tech — it's decoration, not content.
 */
export function Atmosphere() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0 opacity-[0.4] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
        style={{
          backgroundImage: "radial-gradient(rgb(var(--color-text-primary) / 0.14) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-accent/15 blur-[120px]" />
      <div className="absolute -top-10 left-[8%] h-[320px] w-[320px] rounded-full bg-accent-secondary/10 blur-[100px]" />
      <div className="absolute -top-10 right-[8%] h-[320px] w-[320px] rounded-full bg-accent/10 blur-[100px]" />

      <svg
        viewBox="0 0 1600 200"
        preserveAspectRatio="none"
        className="absolute left-0 top-[220px] h-[140px] w-full text-accent opacity-[0.14] sm:top-[260px]"
      >
        <path
          d="M0,100 L520,100 L565,40 L610,160 L655,20 L700,180 L745,60 L790,100 L1600,100"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

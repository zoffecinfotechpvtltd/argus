/**
 * The signature motif running through the whole page: a quiet signal trace standing in for the
 * plain <hr> most sites would use between sections. Same shape as the brand mark's own pulse-line
 * (the line through the "A" in the Argus logo), stretched into a seam — the idea being that the
 * boundary between any two sections is itself a live signal, never a flat line, which is the one
 * sentence Argus is actually selling. Used sparingly (a handful of section boundaries, not every
 * one) so it stays a signature rather than wallpaper.
 *
 * A real h-16 box, not a 1px line with the SVG escaping it via absolute positioning — the earlier
 * version's near-zero-height container relied entirely on overflow from an absolutely positioned
 * child, which read as visually clipped/cut-off depending on exactly where a normal scroll happened
 * to land relative to the surrounding sections' padding. This has genuine layout height of its own.
 */
export function PulseDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`relative flex h-16 w-full items-center justify-center ${className}`} aria-hidden="true">
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <svg viewBox="0 0 400 24" preserveAspectRatio="xMidYMid meet" className="relative h-8 w-[280px] text-accent sm:w-[400px]">
        <path
          d="M0,12 L150,12 L168,3 L186,21 L204,3 L222,21 L240,12 L400,12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

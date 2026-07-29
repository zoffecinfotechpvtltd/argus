/**
 * The ARGUS brand mark — generated from the approved master art (assets/argus-source.png) via
 * scripts/generate-icon.py rather than redrawn, so the shape, gradient, and proportions match the
 * approved artwork exactly. It's a self-contained badge whose own contrast doesn't depend on page
 * theme, so it renders identically in light and dark mode — unlike text/icon colors elsewhere, it
 * never uses `currentColor`.
 */
export function ArgusMark({ size = 28, sweep = false, className = "" }: { size?: number; sweep?: boolean; className?: string }) {
  return (
    <>
      <img
        src="/argus-mark.png"
        width={size}
        height={size}
        alt="Argus"
        className={`${sweep ? "argus-mark-pulse" : ""} ${className}`}
        style={{ objectFit: "contain" }}
      />
      {sweep && (
        <style>{`
          @keyframes argus-mark-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }
          .argus-mark-pulse { animation: argus-mark-pulse 2.4s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) {
            .argus-mark-pulse { animation: none; }
          }
        `}</style>
      )}
    </>
  );
}

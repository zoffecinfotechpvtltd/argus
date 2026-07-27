/** The ARGUS brand mark — cropped from the approved "Monolith Signal" brand sheet, same asset as
 * the product app's ArgusMark (ui/src/components/ArgusMark.tsx). Kept as a plain <img> here too:
 * the marketing site is the one place this dark/purple brand concept is meant to live (see
 * steps/00-README-BUILD-ORDER.md — the product UI itself moved to a light-first system). */
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

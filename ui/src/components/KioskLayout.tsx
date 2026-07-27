import type { ReactNode } from "react";

/**
 * Dedicated shell for kiosk/NOC-wallboard mode — deliberately not a CSS-hidden variant of the
 * normal operational Layout. A screen watched from across a room needs its own composition rules
 * (no sidebar chrome to parse, minimal fixed elements), not the same chrome as a desk-distance
 * investigation view with the navigation stripped out. Individual pages don't yet have a
 * distance-tuned large-type variant of their own content — that's real per-page work for whichever
 * pages actually rotate through kiosk mode (see useKioskMode's KIOSK_PATHS) — this shell only owns
 * what's true for kiosk mode regardless of which page is showing. Follows whatever theme (light or
 * dark) the operator has picked — see useTheme.ts — rather than forcing one.
 */
export function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-canvas text-text-primary">
      <div className="fixed right-4 top-4 z-40 rounded-md border border-border bg-bg-surface px-3 py-1.5 text-2xs text-text-secondary shadow-sm">
        Kiosk mode — move the mouse or press any key to exit
      </div>
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}

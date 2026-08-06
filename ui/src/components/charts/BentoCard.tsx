import type { ComponentProps } from "react";
import { Card } from "../ui";

/**
 * Shared elevation treatment for every chart tile on the Executive Overview dashboard — every
 * other page in the app keeps the flat, shadow-at-rest-never Card from components/ui (see that
 * file's own comment: "no shadow at rest... this system moves state through color only"). That's
 * right for a dense operational tool like Inventory or Settings, but the dashboard is the one
 * screen someone glances at from across a room, where a softly elevated tile reads as the room's
 * own console glass rather than decoration.
 *
 * No hover translation, deliberately — an earlier version lifted the tile a few pixels on hover,
 * which on a dense data grid reads as a marketing-site flourish, not a premium data product (real
 * comparison: Linear, Stripe, and Vercel's own dashboards never move a card under the cursor; the
 * response is a shadow/border shift at most). Hover only deepens the shadow slightly and warms the
 * border — the tile stays exactly where it is. Generous rounded-2xl corners (not the app-wide
 * rounded-lg) is this page's one deliberate softening, paired with the equally-rounded chart marks
 * inside each tile (donut corner radius, treemap tile radius, bar radius) so the "curve" language
 * is consistent between a tile's own shell and the data drawn inside it, not just applied to one
 * and not the other.
 *
 * Originally defined only inside Dashboard.tsx, which meant the ECharts-based tiles living in
 * their own files (AlertActivityCalendar, NotificationDeliverySankey, AckTimeHistogram) never got
 * it and rendered as plain flat Cards next to elevated BentoCards everywhere else on the same
 * page — a visible inconsistency, not a deliberate choice. Extracted here so every chart tile on
 * the page can share the exact same shell.
 */
export function BentoCard({ className = "", children, ...props }: ComponentProps<typeof Card>) {
  return (
    <Card
      className={`group relative overflow-hidden !rounded-2xl !border-border/50 !shadow-[0_1px_2px_rgba(24,24,27,0.06),0_8px_16px_-4px_rgba(24,24,27,0.10)] transition-[box-shadow,border-color] duration-300 ease-out-expo hover:!border-border hover:!shadow-[0_1px_2px_rgba(24,24,27,0.08),0_16px_28px_-6px_rgba(24,24,27,0.16)] dark:!shadow-[0_1px_2px_rgba(0,0,0,0.5),0_8px_16px_-4px_rgba(0,0,0,0.4)] dark:hover:!shadow-[0_1px_2px_rgba(0,0,0,0.6),0_16px_28px_-6px_rgba(0,0,0,0.55)] motion-reduce:transition-none ${className}`}
      {...props}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/[0.14]"
        aria-hidden="true"
      />
      {children}
    </Card>
  );
}

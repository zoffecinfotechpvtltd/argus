import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "critical" | "warning" | "info" | "success";

// Per steps/04-component-spec.md: background = the semantic `-subtle` token, text = the solid
// semantic token, no border — status and brand are different signals, so `accent` here is
// reserved for genuinely brand-related pills (not health/severity), never used for "success".
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-bg-subtle text-text-secondary",
  accent: "bg-accent-subtle text-accent",
  critical: "bg-critical-subtle text-critical",
  warning: "bg-warning-subtle text-warning",
  info: "bg-info-subtle text-info",
  success: "bg-success-subtle text-success",
};

export function Badge({ tone = "neutral", className = "", children, ...props }: { tone?: BadgeTone } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-2xs font-medium ${TONES[tone]} ${className}`} {...props}>
      {children}
    </span>
  );
}

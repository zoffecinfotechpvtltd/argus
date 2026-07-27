import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// Per steps/04-component-spec.md: no gradient, no shadow at rest on any variant — a flat fill,
// shadow-sm only appears on hover for primary. No translate/lift micro-animation either; that was
// a Precision-Signal-era flourish, this system moves state through color only.
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-text-on hover:bg-accent-hover hover:shadow-sm active:bg-accent-active",
  secondary: "border border-border bg-bg-surface text-text-primary hover:bg-bg-subtle",
  destructive: "bg-critical text-white hover:bg-critical/90 hover:shadow-sm",
  ghost: "text-text-secondary hover:bg-bg-subtle hover:text-text-primary",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-2xs",
  md: "px-4 py-3",
};

/** The canonical button — every page should reach for this instead of hand-rolling
 * `rounded-md bg-green-600 px-4 py-2 ...` again. Covers primary/secondary/destructive/ghost per
 * steps/04-component-spec.md. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", ...props },
  ref
) {
  return <button ref={ref} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...props} />;
});

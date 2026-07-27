import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  // Light is the default real theme; dark is a second real theme toggled via a `data-theme="dark"`
  // attribute on <html> (see ui/src/hooks/useTheme.ts) — not prefers-color-scheme, an operator
  // picks this deliberately. `dark:` utilities target that attribute, not Tailwind's `.dark` class.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Per steps/01-design-tokens.css / 02-design-tokens.json — the current system. Reach for
        // these in all new/rebuilt code.
        "bg-canvas": "rgb(var(--color-bg-canvas) / <alpha-value>)",
        "bg-surface": "rgb(var(--color-bg-surface) / <alpha-value>)",
        "bg-elevated": "rgb(var(--color-bg-elevated) / <alpha-value>)",
        "bg-subtle": "rgb(var(--color-bg-subtle) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "border-strong": "rgb(var(--color-border-strong) / <alpha-value>)",
        "text-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--color-text-secondary) / <alpha-value>)",
        "text-muted": "rgb(var(--color-text-muted) / <alpha-value>)",
        "text-inverse": "rgb(var(--color-text-inverse) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          hover: "rgb(var(--color-accent-hover) / <alpha-value>)",
          active: "rgb(var(--color-accent-active) / <alpha-value>)",
          subtle: "rgb(var(--color-accent-subtle) / <alpha-value>)",
          "text-on": "rgb(var(--color-accent-text-on) / <alpha-value>)",
        },
        success: { DEFAULT: "rgb(var(--color-success) / <alpha-value>)", subtle: "rgb(var(--color-success-subtle) / <alpha-value>)" },
        warning: { DEFAULT: "rgb(var(--color-warning) / <alpha-value>)", subtle: "rgb(var(--color-warning-subtle) / <alpha-value>)" },
        critical: { DEFAULT: "rgb(var(--color-critical) / <alpha-value>)", subtle: "rgb(var(--color-critical-subtle) / <alpha-value>)" },
        info: { DEFAULT: "rgb(var(--color-info) / <alpha-value>)", subtle: "rgb(var(--color-info-subtle) / <alpha-value>)" },
        chart: {
          1: "rgb(var(--chart-1) / <alpha-value>)",
          2: "rgb(var(--chart-2) / <alpha-value>)",
          3: "rgb(var(--chart-3) / <alpha-value>)",
          4: "rgb(var(--chart-4) / <alpha-value>)",
          5: "rgb(var(--chart-5) / <alpha-value>)",
          grid: "rgb(var(--chart-grid) / <alpha-value>)",
        },
      },
      spacing: {
        xs: "var(--space-xs)",
        sm: "var(--space-sm)",
        md: "var(--space-md)",
        lg: "var(--space-lg)",
        xl: "var(--space-xl)",
        "2xl": "var(--space-2xl)",
        "3xl": "var(--space-3xl)",
      },
      // Type scale — steps/03-typography-setup.md. [fontSize, {lineHeight, letterSpacing}] pairs.
      fontSize: {
        "2xs": ["var(--text-2xs)", { lineHeight: "16px" }],
        sm: ["var(--text-sm)", { lineHeight: "18px" }],
        base: ["var(--text-base)", { lineHeight: "20px" }],
        md: ["var(--text-md)", { lineHeight: "24px" }],
        lg: ["var(--text-lg)", { lineHeight: "28px" }],
        xl: ["var(--text-xl)", { lineHeight: "32px", letterSpacing: "var(--tracking-tighter)" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "40px", letterSpacing: "var(--tracking-tightest)" }],
        "3xl": ["var(--text-3xl)", { lineHeight: "48px", letterSpacing: "var(--tracking-tightest)" }],
      },
      letterSpacing: {
        tight: "var(--tracking-tight)",
        tighter: "var(--tracking-tighter)",
        tightest: "var(--tracking-tightest)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
      },
      transitionTimingFunction: {
        "out-expo": "var(--ease-out-expo)",
      },
      transitionDuration: {
        micro: "120ms",
        enter: "200ms",
      },
      fontFamily: {
        sans: ['"Geist"', ...defaultTheme.fontFamily.sans],
        display: ['"Geist"', ...defaultTheme.fontFamily.sans],
        mono: ['"Geist Mono"', ...defaultTheme.fontFamily.mono],
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  // Light is the default; dark is the marketing site's natural home (matches the "Monolith
  // Signal" brand concept it's built around) — toggled via [data-theme] same as the product app,
  // see src/hooks/useTheme.ts. Defaults to dark on first visit (see index.html's theme-init.js).
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        elevated: "rgb(var(--color-elevated) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        fog: "rgb(var(--color-text-primary) / <alpha-value>)",
        muted: "rgb(var(--color-text-secondary) / <alpha-value>)",
        dim: "rgb(var(--color-text-muted) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          hover: "rgb(var(--color-accent-hover) / <alpha-value>)",
          active: "rgb(var(--color-accent-active) / <alpha-value>)",
          subtle: "rgb(var(--color-accent-subtle) / <alpha-value>)",
          secondary: "rgb(var(--color-accent-secondary) / <alpha-value>)",
          "text-on": "rgb(var(--color-accent-text-on) / <alpha-value>)",
        },
        status: {
          healthy: "rgb(var(--color-success) / <alpha-value>)",
          warning: "rgb(var(--color-warning) / <alpha-value>)",
          critical: "rgb(var(--color-critical) / <alpha-value>)",
          info: "rgb(var(--color-info) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "sans-serif"],
        sans: ["Manrope", "ui-sans-serif", "sans-serif"],
        mono: ["Fira Code", "ui-monospace", "monospace"],
      },
      boxShadow: {
        accent: "0 0 0 1px rgb(var(--color-accent) / 0.4), 0 12px 40px -12px rgb(var(--color-accent) / 0.55)",
        "accent-lg": "0 0 0 1px rgb(var(--color-accent) / 0.55), 0 18px 48px -12px rgb(var(--color-accent) / 0.7)",
      },
    },
  },
  plugins: [],
};

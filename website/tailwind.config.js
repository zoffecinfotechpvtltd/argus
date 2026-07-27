/** @type {import('tailwindcss').Config} */
export default {
  // Light is this site's flagship system (editorial, Apple-inspired) — dark is a derived
  // secondary, toggled via [data-theme] same as the product app, see src/hooks/useTheme.ts.
  // Defaults to light on first visit (see public/theme-init.js).
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
        display: ["Inter", "ui-sans-serif", "sans-serif"],
        sans: ["Inter", "ui-sans-serif", "sans-serif"],
        mono: ["Fira Code", "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 24px 48px -24px rgba(0,0,0,0.12)",
        "soft-lg": "0 1px 2px rgba(0,0,0,0.04), 0 40px 80px -32px rgba(0,0,0,0.18)",
      },
    },
  },
  plugins: [],
};

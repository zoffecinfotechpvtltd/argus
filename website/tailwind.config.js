/** @type {import('tailwindcss').Config} */
export default {
  // Dark (a NOC command-center system) is this site's flagship — light is a derived secondary,
  // toggled via [data-theme] same as the product app, see src/hooks/useTheme.ts. Defaults to dark
  // on first visit (see public/theme-init.js). This darkMode config is otherwise unused — every
  // color here is a CSS custom property that already flips with [data-theme], not Tailwind's
  // `dark:` variant, which this codebase doesn't use anywhere.
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
      // Fluid type scale: grows smoothly with viewport width (clamp(min, preferred, max)) instead
      // of sitting at one fixed px value regardless of screen size — a 1440px laptop and a 2560px+
      // monitor both get proportionally-sized text rather than the exact same pixel count reading
      // small on the bigger one. Use these (text-fluid-*) for body copy, labels, nav, and footer
      // text sitewide; headings already use their own per-component clamp() in the h1/h2 classes.
      fontSize: {
        "fluid-xs": ["clamp(0.75rem, 0.7rem + 0.2vw, 0.875rem)", { lineHeight: "1.5" }],
        "fluid-sm": ["clamp(0.875rem, 0.8rem + 0.3vw, 1rem)", { lineHeight: "1.55" }],
        "fluid-base": ["clamp(1rem, 0.92rem + 0.4vw, 1.1875rem)", { lineHeight: "1.6" }],
        "fluid-lg": ["clamp(1.125rem, 1rem + 0.6vw, 1.375rem)", { lineHeight: "1.5" }],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 24px 48px -24px rgba(0,0,0,0.12)",
        "soft-lg": "0 1px 2px rgba(0,0,0,0.04), 0 40px 80px -32px rgba(0,0,0,0.18)",
      },
    },
  },
  plugins: [],
};

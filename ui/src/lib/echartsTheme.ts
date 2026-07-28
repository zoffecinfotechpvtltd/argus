import { useEffect, useState } from "react";

/** ECharts renders to canvas, so it can't consume `rgb(var(--x) / <alpha>)` the way Tailwind/SVG
 * can — it needs real resolved color strings. This reads the same CSS custom properties
 * index.css defines (the single source of truth for both) via getComputedStyle, and re-reads
 * whenever the app's dark-mode toggle flips `data-theme` on <html> — watched directly via
 * MutationObserver rather than the useTheme() hook, since that hook's state isn't shared across
 * independent call sites (each instance only reads localStorage once on its own mount), so a
 * chart mounted before a theme toggle elsewhere wouldn't otherwise learn about the change. */

export interface EchartsColors {
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  bgSurface: string;
  bgElevated: string;
  bgSubtle: string;
  accent: string;
  success: string;
  warning: string;
  critical: string;
  info: string;
  categorical: string[];
}

function readVar(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `rgb(${raw.replace(/\s+/g, ",")})` : "#888888";
}

function readColors(): EchartsColors {
  return {
    textPrimary: readVar("--color-text-primary"),
    textSecondary: readVar("--color-text-secondary"),
    textMuted: readVar("--color-text-muted"),
    border: readVar("--color-border"),
    bgSurface: readVar("--color-bg-surface"),
    bgElevated: readVar("--color-bg-elevated"),
    bgSubtle: readVar("--color-bg-subtle"),
    accent: readVar("--color-accent"),
    success: readVar("--color-success"),
    warning: readVar("--color-warning"),
    critical: readVar("--color-critical"),
    info: readVar("--color-info"),
    categorical: [readVar("--chart-1"), readVar("--chart-2"), readVar("--chart-3"), readVar("--chart-4"), readVar("--chart-5")],
  };
}

export function useEchartsColors(): EchartsColors {
  const [colors, setColors] = useState<EchartsColors>(readColors);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

/** Shared tooltip container style — matches the Recharts tooltips already used elsewhere
 * (rounded-md border bg-bg-elevated px-3 py-2 text-xs shadow-md) so an ECharts widget sitting
 * next to a Recharts one doesn't look like it wandered in from a different app. */
export function echartsTooltipStyle(colors: EchartsColors) {
  return {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    padding: [8, 12],
    textStyle: { color: colors.textPrimary, fontSize: 12, fontFamily: "Geist, ui-sans-serif, sans-serif" },
    extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.12);",
  };
}

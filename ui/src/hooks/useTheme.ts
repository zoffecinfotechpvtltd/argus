import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "argus.theme";
export type Theme = "light" | "dark";

function apply(theme: Theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

/**
 * Light is the default, real theme — dark is a second real theme (true graphite, no purple tint)
 * an operator picks deliberately, per steps/01-design-tokens.css. Not driven by
 * prefers-color-scheme: this is a NOC tool people may run on a shared wallboard, so the choice is
 * explicit and persisted (localStorage), not inferred from whatever OS the browser happens to run on.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light"));

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}

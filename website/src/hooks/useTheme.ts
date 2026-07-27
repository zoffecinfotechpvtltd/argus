import { useEffect, useState } from "react";

const STORAGE_KEY = "argus-site-theme";

function readInitialTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Mirrors the product app's useTheme hook (ui/src/hooks/useTheme.ts) — same storage-key pattern,
 * same [data-theme] attribute, kept as a separate copy since the website is a standalone Vite app
 * with no shared package boundary to the product UI. */
export function useTheme() {
  const [theme, setThemeState] = useState<"light" | "dark">(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function setTheme(next: "light" | "dark") {
    setThemeState(next);
  }

  function toggle() {
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }

  return { theme, setTheme, toggle };
}

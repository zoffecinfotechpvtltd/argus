import type { ReactNode } from "react";
import { Menu, Moon, MonitorPlay, Search, Sun } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { ConnectionIndicator } from "./ConnectionIndicator";

/**
 * The slim sticky header per steps/05-page-specs.md §1: page title left, connection-status +
 * Cmd+K hint + user menu right, height ≤56px (h-14 = 56px exactly). Opens CommandPalette via a
 * synthetic keydown event rather than lifting palette state up here, since CommandPalette already
 * owns its own open/close state via a global key listener.
 *
 * Brand-colored, deliberately — this is the one element present on every single page, so it's
 * where this app spends the one piece of visual boldness the rest of the design system holds back
 * ("no shadow at rest," flat cards everywhere else). The gradient is the exact same indigo already
 * used as --color-accent throughout the app (buttons, the Live pulse dot, focus rings) — not a new
 * color introduced just for this bar, just the brand's own hue given more surface area in the one
 * place that's always visible. Kept identical across light/dark theme (a brand mark shouldn't
 * invert with the page around it), with every child element re-tuned for white-on-purple contrast
 * instead of the neutral text-primary/text-secondary tokens the rest of the app uses on a plain
 * surface.
 */
export function ContextBar({ title, onOpenMobile, onEnterKiosk }: { title?: ReactNode; onOpenMobile: () => void; onEnterKiosk: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  function openCommandPalette() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 bg-gradient-to-br from-[#4338CA] via-[#5B21B6] to-[#7C3AED] px-4 shadow-[0_1px_3px_rgba(0,0,0,0.15)] sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onOpenMobile}
          aria-label="Open menu"
          className="cursor-pointer rounded-md p-1.5 text-white/80 transition-colors duration-micro hover:bg-white/10 hover:text-white lg:hidden"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        {title ? (
          <h1 className="truncate font-display text-md font-semibold tracking-tight text-white">{title}</h1>
        ) : (
          <span className="text-sm text-white/50">&nbsp;</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm text-white/80">
        <button
          onClick={openCommandPalette}
          className="hidden cursor-pointer items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white/80 transition-colors duration-micro hover:border-white/30 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#5B21B6] sm:flex"
        >
          <Search size={14} className="shrink-0" aria-hidden="true" />
          <span className="hidden md:inline">Search…</span>
          <span className="ml-auto shrink-0 rounded border border-white/20 px-1.5 py-0.5 font-mono text-2xs text-white/60">Ctrl K</span>
        </button>
        <button
          onClick={openCommandPalette}
          aria-label="Search"
          className="cursor-pointer rounded-md p-1.5 text-white/80 transition-colors duration-micro hover:bg-white/10 hover:text-white sm:hidden"
        >
          <Search size={16} aria-hidden="true" />
        </button>
        <ConnectionIndicator />
        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="cursor-pointer rounded-md p-1.5 text-white/80 transition-colors duration-micro hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
        <button
          onClick={onEnterKiosk}
          aria-label="Enter kiosk mode"
          title="Kiosk mode — fullscreen, auto-rotating NOC display"
          className="hidden cursor-pointer rounded-md p-1.5 text-white/80 transition-colors duration-micro hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:block"
        >
          <MonitorPlay size={16} aria-hidden="true" />
        </button>
        <span className="hidden h-5 w-px bg-white/20 lg:block" aria-hidden="true" />
        <span className="hidden text-2xs text-white/70 lg:inline">
          {user?.email} · <span className="capitalize text-white/50">{user?.role}</span>
        </span>
        <button
          onClick={() => logout()}
          className="cursor-pointer rounded-md border border-white/25 px-3 py-1.5 text-2xs font-medium text-white transition-colors duration-micro hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#5B21B6]"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

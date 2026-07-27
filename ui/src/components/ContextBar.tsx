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
 */
export function ContextBar({ title, onOpenMobile, onEnterKiosk }: { title?: ReactNode; onOpenMobile: () => void; onEnterKiosk: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  function openCommandPalette() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onOpenMobile}
          aria-label="Open menu"
          className="cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors duration-micro hover:bg-bg-subtle hover:text-text-primary lg:hidden"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        {title ? (
          <h1 className="truncate text-md font-semibold text-text-primary">{title}</h1>
        ) : (
          <span className="text-sm text-text-muted">&nbsp;</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm text-text-secondary">
        <button
          onClick={openCommandPalette}
          className="hidden cursor-pointer items-center gap-2 rounded-md border border-border bg-bg-canvas px-3 py-1.5 text-sm text-text-secondary transition-colors duration-micro hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface sm:flex"
        >
          <Search size={14} className="shrink-0" aria-hidden="true" />
          <span className="hidden md:inline">Search…</span>
          <span className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-2xs text-text-muted">Ctrl K</span>
        </button>
        <button
          onClick={openCommandPalette}
          aria-label="Search"
          className="cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors duration-micro hover:bg-bg-subtle hover:text-text-primary sm:hidden"
        >
          <Search size={16} aria-hidden="true" />
        </button>
        <ConnectionIndicator />
        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors duration-micro hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
        <button
          onClick={onEnterKiosk}
          aria-label="Enter kiosk mode"
          title="Kiosk mode — fullscreen, auto-rotating NOC display"
          className="hidden cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors duration-micro hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:block"
        >
          <MonitorPlay size={16} aria-hidden="true" />
        </button>
        <span className="hidden text-2xs lg:inline">
          {user?.email} · <span className="capitalize text-text-muted">{user?.role}</span>
        </span>
        <button
          onClick={() => logout()}
          className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-2xs font-medium transition-colors duration-micro hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

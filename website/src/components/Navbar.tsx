import { useState } from "react";
import { Menu, X, Sun, Moon } from "lucide-react";
import { ArgusMark } from "./ArgusMark";
import { SITE } from "../config";
import { useTheme } from "../hooks/useTheme";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#alerting", label: "Alerting" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar({ downloadUrl }: { downloadUrl: string }) {
  const [open, setOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    // Always solid + blurred, never transparent — a transparent-at-top nav read as a rendering
    // glitch here (Hero's own headline scrolls up directly behind/through it with nothing to
    // separate them) rather than the deliberate hero-blend effect it was on the old light design.
    <nav className="sticky top-0 z-50 border-b border-border bg-canvas/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <a href="#top" className="flex items-center gap-2">
          <ArgusMark size={20} />
          <span className="font-display text-fluid-base font-semibold tracking-tight text-fog">Argus</span>
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-fluid-sm font-medium text-muted transition-colors hover:text-fog">
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="cursor-pointer rounded-full p-1.5 text-muted transition-colors hover:text-fog"
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <a
            href={`mailto:${SITE.contactEmail}`}
            className="hidden cursor-pointer text-fluid-sm font-medium text-muted transition-colors hover:text-fog sm:block"
          >
            Contact sales
          </a>
          <a
            href={downloadUrl}
            download
            className="hidden cursor-pointer items-center rounded-full bg-fog px-5 py-2 text-fluid-sm font-medium text-canvas transition-opacity hover:opacity-80 sm:inline-flex"
          >
            Download
          </a>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-fog md:hidden"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-fluid-sm font-medium text-muted">
                {l.label}
              </a>
            ))}
            <a href={`mailto:${SITE.contactEmail}`} className="text-fluid-sm font-medium text-muted">
              Contact sales
            </a>
            <a href={downloadUrl} download className="rounded-full bg-fog px-4 py-2.5 text-center text-fluid-sm font-medium text-canvas">
              Download for Windows
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

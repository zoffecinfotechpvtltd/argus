import { useEffect, useState } from "react";
import { Menu, X, Download, Sun, Moon } from "lucide-react";
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
  const [scrolled, setScrolled] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        className={`mx-auto max-w-6xl rounded-xl border bg-canvas transition-colors duration-300 ${
          scrolled ? "border-border" : "border-transparent"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 sm:px-5">
          <a href="#top" className="flex items-center gap-2.5">
            <ArgusMark size={24} />
            <span className="font-display text-base font-bold tracking-[0.06em] text-fog">ARGUS</span>
          </a>

          <div className="hidden items-center gap-7 md:flex">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="group relative py-1 text-sm font-medium text-muted transition-colors hover:text-fog">
                {l.label}
                <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-accent transition-transform duration-200 group-hover:scale-x-100" />
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="cursor-pointer rounded-md p-2 text-muted transition-colors hover:text-fog"
            >
              {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <a
              href={`mailto:${SITE.contactEmail}`}
              className="hidden cursor-pointer text-sm font-medium text-muted transition-colors hover:text-fog sm:block"
            >
              Contact sales
            </a>
            <a
              href={downloadUrl}
              download
              className="hidden cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-text-on transition-colors hover:bg-accent-hover sm:inline-flex"
            >
              <Download size={14} strokeWidth={2.8} aria-hidden="true" />
              Download
            </a>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-fog md:hidden"
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {open && (
          <div className="border-t border-border px-5 py-4 md:hidden">
            <div className="flex flex-col gap-4">
              {LINKS.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-sm font-medium text-muted">
                  {l.label}
                </a>
              ))}
              <a href={`mailto:${SITE.contactEmail}`} className="text-sm font-medium text-muted">
                Contact sales
              </a>
              <a href={downloadUrl} download className="rounded-md bg-accent px-4 py-2.5 text-center text-sm font-bold text-accent-text-on">
                Download for Windows
              </a>
            </div>
          </div>
        )}
      </nav>
    </div>
  );
}

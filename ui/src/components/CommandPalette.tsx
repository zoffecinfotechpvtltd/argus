import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, LayoutDashboard, Router, Siren } from "lucide-react";
import { api } from "../api/client";

interface Device {
  id: string;
  name: string;
  ip: string;
}

interface AlertLookup {
  id: string;
  title: string;
  deviceId: string;
  severity: string;
}

const STATIC_COMMANDS = [
  { label: "Go to Dashboard", path: "/" },
  { label: "Go to Inventory", path: "/inventory" },
  { label: "Go to Discovery", path: "/discovery" },
  { label: "Go to Bandwidth", path: "/bandwidth" },
  { label: "Go to Alerts", path: "/alerts" },
  { label: "Go to Topology Map", path: "/map" },
  { label: "Go to Reports", path: "/reports" },
  { label: "Go to Notification Settings", path: "/settings/notifications" },
];

type PaletteItem =
  | { kind: "device"; id: string; label: string; sublabel: string; path: string }
  | { kind: "alert"; id: string; label: string; sublabel: string; path: string }
  | { kind: "page"; id: string; label: string; path: string };

/** A real combobox, not just a styled `<div>` list: the text input keeps DOM focus the whole
 * time (the standard pattern real command palettes use — Linear, VS Code's Cmd+P), Up/Down move a
 * visually- and `aria-activedescendant`-tracked selection, Enter activates it, and the dialog
 * itself carries role="dialog"/aria-modal so a screen reader announces it as a dialog rather than
 * silently-appearing page content. None of that existed before — this was a `<div>` with an
 * `<input>` and click-only rows. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [openAlerts, setOpenAlerts] = useState<AlertLookup[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    api
      .get<{ items: Device[] }>(`/devices?search=${encodeURIComponent(query)}&limit=8`)
      .then((page) => setDevices(page.items))
      .catch(() => setDevices([]));
  }, [open, query]);

  // Open alerts are fetched once per palette-open (not per keystroke — there's no server-side
  // text search on alerts) and filtered client-side by title, same as the static page commands.
  useEffect(() => {
    if (!open) return;
    api
      .get<{ items: AlertLookup[] }>("/alerts?status=open&limit=200")
      .then((page) => setOpenAlerts(page.items))
      .catch(() => setOpenAlerts([]));
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const deviceItems: PaletteItem[] = devices.map((d) => ({ kind: "device", id: `device-${d.id}`, label: d.name, sublabel: d.ip, path: `/devices/${d.id}` }));
    const q = query.toLowerCase();
    const alertItems: PaletteItem[] =
      q.length > 0
        ? openAlerts
            .filter((a) => a.title.toLowerCase().includes(q))
            .slice(0, 6)
            .map((a) => ({ kind: "alert", id: `alert-${a.id}`, label: a.title, sublabel: a.severity, path: `/devices/${a.deviceId}` }))
        : [];
    const pageItems: PaletteItem[] = STATIC_COMMANDS.filter((c) => c.label.toLowerCase().includes(q)).map((c) => ({
      kind: "page",
      id: `page-${c.path}`,
      label: c.label,
      path: c.path,
    }));
    return [...deviceItems, ...alertItems, ...pageItems];
  }, [devices, openAlerts, query]);

  useEffect(() => setActiveIndex(0), [items.length, query]);

  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(items[activeIndex]?.id ?? "")}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  if (!open) return null;

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) go(item.path);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg rounded-lg border border-border bg-bg-elevated shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-listbox"
            aria-activedescendant={items[activeIndex]?.id}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a device, open alert, or page…"
            className="w-full bg-transparent py-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <div id="cmdk-listbox" ref={listRef} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-text-muted">No matches.</p>}
          {items.map((item, i) => (
            <div
              key={item.id}
              id={item.id}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => go(item.path)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-micro ${
                i === activeIndex ? "bg-bg-subtle text-text-primary" : "text-text-secondary"
              }`}
            >
              {item.kind === "device" ? (
                <Router size={15} className="shrink-0" aria-hidden="true" />
              ) : item.kind === "alert" ? (
                <Siren size={15} className="shrink-0" aria-hidden="true" />
              ) : (
                <LayoutDashboard size={15} className="shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{item.label}</span>
              {(item.kind === "device" || item.kind === "alert") && (
                <span className="ml-auto shrink-0 text-xs capitalize text-text-secondary">{item.sublabel}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

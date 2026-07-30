import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromIsoDate(s: string): Date | null {
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts as [number, number, number];
  return new Date(y, m - 1, d);
}

function formatDisplay(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]!.slice(0, 3)} ${d.getFullYear()}`;
}

/**
 * Replaces the native <input type="date"> for the license portal's "Expires on" field — same
 * reasoning as CustomSelect: the browser's own date-picker popup is unstylable OS chrome (a plain
 * white calendar regardless of the page's theme), which is exactly why it looked out of place
 * here. Value/onChange still use plain "YYYY-MM-DD" strings so the rest of the form (and the
 * API payload) doesn't need to change.
 */
export function CustomDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? fromIsoDate(value) : null;
  const [viewMonth, setViewMonth] = useState(() => selected ?? new Date());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Deliberately keyed on `open` alone: re-centering the calendar on `selected` every time it
  // changes (e.g. while typing) would fight the user's own navigation between months.
  useEffect(() => {
    if (open) setViewMonth(selected ?? new Date());
  }, [open]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells: (Date | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="input flex w-full cursor-pointer items-center justify-between text-left"
      >
        <span className={selected ? "text-fog" : "text-dim"}>{selected ? formatDisplay(selected) : "Select a date…"}</span>
        <Calendar size={15} className="shrink-0 text-dim" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-[calc(100%+6px)] z-20 w-64 rounded-lg border border-border bg-elevated p-3 shadow-soft-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth(new Date(year, month - 1, 1))}
              aria-label="Previous month"
              className="cursor-pointer rounded p-1 text-muted hover:text-fog"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-semibold text-fog">
              {MONTH_NAMES[month]} {year}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth(new Date(year, month + 1, 1))}
              aria-label="Next month"
              className="cursor-pointer rounded p-1 text-muted hover:text-fog"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {WEEKDAYS.map((w, i) => (
              <span key={`${w}-${i}`} className="text-[11px] font-medium text-dim">
                {w}
              </span>
            ))}
            {cells.map((d, i) =>
              d ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(toIsoDate(d));
                    setOpen(false);
                  }}
                  className={`mx-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-xs transition-colors ${
                    selected && isSameDay(d, selected)
                      ? "bg-accent font-semibold text-accent-text-on"
                      : isSameDay(d, today)
                        ? "font-semibold text-accent"
                        : "text-fog hover:bg-accent-subtle"
                  }`}
                >
                  {d.getDate()}
                </button>
              ) : (
                <span key={i} />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

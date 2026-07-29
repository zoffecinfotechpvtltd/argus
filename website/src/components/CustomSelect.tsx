import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * Replaces the native <select> for the one dropdown on the site (Contact's plan picker). A native
 * select's own popup is OS-chrome — Chrome/Edge/Firefox all render it in the system's default
 * light style, tiny padding, no theming hook at all, regardless of how big or dark the rest of the
 * page is. This is a fully custom listbox (real ARIA roles, keyboard nav, click-outside-to-close)
 * styled to match the site instead.
 */
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, options.indexOf(value)));
  }, [open, value, options]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      listRef.current?.querySelectorAll("li")[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) {
        onChange(options[activeIndex]!);
        setOpen(false);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input flex w-full cursor-pointer items-center justify-between text-left"
      >
        <span className={value ? "text-fog" : "text-dim"}>{value || placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-64 overflow-y-auto rounded-lg border border-border bg-elevated py-1.5 shadow-soft-lg outline-none"
        >
          {options.map((opt, i) => (
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`flex cursor-pointer items-center justify-between px-3.5 py-2.5 text-fluid-sm ${
                i === activeIndex ? "bg-accent-subtle text-accent" : "text-fog"
              }`}
            >
              {opt}
              {opt === value && <Check size={15} className="shrink-0 text-accent" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

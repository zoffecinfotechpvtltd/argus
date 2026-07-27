import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
  /** Panel width. Defaults to "md" (the original fixed `max-w-md`) so every existing call site is
   * unaffected — "lg"/"xl" are opt-in for content that needs more room (e.g. a calendar-style grid). */
  size?: "md" | "lg" | "xl";
  /** "center" (default) is the original centered dialog. "slide-over" is the component spec's
   * preferred shape for edit/add flows (steps/04-component-spec.md "Modal / slide-over") — a
   * right-anchored, full-height panel so table/page context stays visible behind it, per
   * steps/05-page-specs.md §3's explicit instruction for Inventory's add/edit flow. */
  variant?: "center" | "slide-over";
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/** A real dialog: role="dialog" + aria-modal, focus moves in on open and is trapped inside (Tab/
 * Shift+Tab cycle, never escaping to the page behind), Escape closes, and focus returns to
 * whatever triggered it on close. MASTER.md's `.modal`/`.modal-overlay` spec, made actually usable
 * with a keyboard or screen reader — every hand-rolled "fixed inset-0 backdrop + centered box" in
 * this app had none of that. */
export function Modal({ open, onClose, title, children, footer, labelledBy, size = "md", variant = "center" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(labelledBy ?? `modal-title-${Math.random().toString(36).slice(2)}`).current;
  const triggerRef = useRef<Element | null>(null);
  // Starts false so the slide-over panel mounts off-screen, then flips true next frame — same
  // "starts hidden, flips on next frame" trick as Dashboard's top-strip reveal, so the translate-x
  // transition actually has something to animate from instead of appearing already in place.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();

    let raf = 0;
    if (variant === "slide-over") raf = requestAnimationFrame(() => setEntered(true));

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose, variant]);

  useEffect(() => {
    if (!open) setEntered(false);
  }, [open]);

  if (!open) return null;

  if (variant === "slide-over") {
    return createPortal(
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`absolute inset-y-0 right-0 flex w-full ${SIZE_CLASS[size]} flex-col rounded-l-lg border-l border-border bg-bg-elevated shadow-lg outline-none transition-transform duration-200 ease-out ${
            entered ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex-1 overflow-y-auto p-6">
            <h2 id={titleId} className="mb-4 text-lg font-semibold text-text-primary">
              {title}
            </h2>
            <div className="text-sm text-text-secondary">{children}</div>
          </div>
          {footer && <div className="flex justify-end gap-3 border-t border-border p-4">{footer}</div>}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${SIZE_CLASS[size]} rounded-lg border border-border bg-bg-elevated p-6 shadow-lg outline-none`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold text-text-primary">
          {title}
        </h2>
        <div className="text-sm text-text-secondary">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

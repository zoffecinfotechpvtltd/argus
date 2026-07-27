import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, typeof CheckCircle2> = { success: CheckCircle2, error: XCircle, info: Info };
// `success` previously read the brand accent color — the same "brand doing double duty as
// status" bug fixed in Badge.tsx. A "Saved successfully" toast must read as success-green, never
// brand-indigo, or the two meanings collide.
const TONE_CLASS: Record<ToastTone, string> = {
  success: "border-success/20 text-success",
  error: "border-critical/20 text-critical",
  info: "border-info/20 text-info",
};

const AUTO_DISMISS_MS = 4000;

/** Replaces the scattered "Saved ✓" text-in-page pattern with a real toast — consistent
 * placement, an icon instead of a punctuation mark standing in for one, auto-dismiss, and an
 * aria-live region so a screen reader actually announces it instead of silently updating text
 * somewhere on the page. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), AUTO_DISMISS_MS);
  }, []);

  const api = useRef<ToastApi>({
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  }).current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-2 rounded-lg border bg-bg-elevated px-4 py-3 text-sm text-text-primary shadow-lg ${TONE_CLASS[t.tone]}`}
            >
              <Icon size={16} className="shrink-0" />
              <span>{t.message}</span>
              <button
                onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
                className="ml-2 cursor-pointer text-text-muted transition-colors duration-micro hover:text-text-primary"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within <ToastProvider>");
  return ctx;
}

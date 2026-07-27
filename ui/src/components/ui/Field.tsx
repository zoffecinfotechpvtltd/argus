import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

// Deliberately no width utility here — a caller-supplied `w-auto`/`w-40` in `className` isn't
// guaranteed to win a Tailwind cascade conflict against a width baked into this base string
// (equal-specificity utilities resolve by their position in the compiled stylesheet, not by
// position in the className string). Width is the caller's call: add `w-full` explicitly where
// that's wanted (most form layouts) and leave it off for inline toolbar-sized fields.
// Per steps/04-component-spec.md: flat surface, no inset shadow. Border goes accent on focus,
// critical on `aria-invalid` (set by FieldGroup when it has an `error`) — Tailwind's built-in
// `aria-invalid:` variant reads the DOM attribute directly, no extra prop plumbing needed.
const FIELD_BASE =
  "rounded-md border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-micro hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface aria-invalid:border-critical aria-invalid:focus-visible:border-critical disabled:cursor-not-allowed disabled:opacity-40";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={`${FIELD_BASE} ${className}`} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = "", ...props },
  ref
) {
  return <textarea ref={ref} className={`${FIELD_BASE} resize-none ${className}`} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = "", ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={`${FIELD_BASE} cursor-pointer appearance-none pr-9 ${className}`} {...props} />
      <ChevronDown size={14} strokeWidth={2.5} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
    </div>
  );
});

/** Wraps any of the above with a consistent label + optional hint/error line, and wires the
 * `for`/`id`/`aria-describedby`/`aria-invalid` triangle so the label, hint, and error state are
 * actually programmatically associated with the control — not just visually adjacent. */
export function FieldGroup({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (ids: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text-secondary">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true } : {}) })}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-2xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-2xs text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a hover state for clickable cards. Skip it for static content cards (most settings panels). */
  interactive?: boolean;
}

// Per steps/04-component-spec.md: no shadow at rest on in-page cards — shadow-sm is reserved for
// things that float above content (dropdowns, popovers), not routine cards. No lift/translate
// hover motion either; that was a Precision-Signal-era flourish, this system moves state through
// color only.
export function Card({ interactive = false, className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-border bg-bg-surface transition-colors duration-micro ${
        interactive ? "cursor-pointer hover:border-border-strong hover:shadow-sm" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action, description }: { title: ReactNode; action?: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-md font-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-2xs text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`p-6 text-sm ${className}`}>{children}</div>;
}

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** One consistent empty state instead of the three different ad hoc treatments (dashed boxes on
 * some pages, plain text on others) the app had before. Per steps/04-component-spec.md: state
 * what's missing, state the action to take, one button — no illustration needed for an infra tool. */
export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <Icon size={28} className="mb-3 text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description && <p className="mt-1 max-w-sm text-2xs text-text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

import type { ReactNode } from "react";

/**
 * The page title itself now lives in the global header (ContextBar) per steps/05-page-specs.md §1
 * — this component only carries what's specific to the page: the descriptive subtitle and the
 * one consistent primary-action slot (e.g. Inventory's "Add device"), so it doesn't duplicate the
 * title underneath itself.
 */
export function PageHeader({ subtitle, action }: { subtitle?: ReactNode; action?: ReactNode }) {
  if (!subtitle && !action) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      {subtitle ? <p className="text-sm text-text-secondary">{subtitle}</p> : <span />}
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

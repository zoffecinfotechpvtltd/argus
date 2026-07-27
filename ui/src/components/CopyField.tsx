import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useToast } from "./ui";

function IconButton({ onClick, "aria-label": ariaLabel, children }: { onClick: () => void; "aria-label": string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-transparent p-2 text-text-secondary transition-colors duration-150 hover:border-border-strong hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
    >
      {children}
    </button>
  );
}

/**
 * A read-only, copyable value row — used for the handful of URLs an admin needs to paste
 * somewhere else (an IdP's config screen, a status page link) rather than type. Shared by
 * SettingsSso.tsx and SettingsStatusPage.tsx so both present these the same way.
 */
export function CopyField({ label, value, hint, openable }: { label: string; value: string; hint?: string; openable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard.");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  return (
    <div>
      <label className="mb-1 block text-sm text-text-secondary">{label}</label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-xs text-text-primary">{value}</code>
        <IconButton onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check size={14} className="text-accent" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </IconButton>
        {openable && (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${label} in a new tab`}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-transparent p-2 text-text-secondary transition-colors duration-150 hover:border-border-strong hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
          >
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

import { ShieldCheck } from "lucide-react";
import { Modal, Button } from "./ui";

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  version?: string;
  text: string | null;
}

/** Splits the plain-text terms (see TERMS_TEXT in @api/routes/setup.ts — a title line, then
 * blank-line-separated "N. ..." clauses with soft-wrapped continuation lines) into a title plus
 * numbered clauses, collapsing each clause's internal line-wrapping into one flowing paragraph.
 * Falls back to the raw text as a single block if it doesn't match that shape, so an edited
 * TERMS_TEXT never renders broken — just less prettily. */
function parseTerms(text: string): { title: string; clauses: string[] } {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim());
  const [title, ...rest] = blocks;
  const clauses = rest.map((b) => b.replace(/\s+/g, " ").replace(/^(\d+)\.\s*/, ""));
  return { title: title ?? text, clauses };
}

export function TermsModal({ open, onClose, onAccept, version, text }: TermsModalProps) {
  const parsed = text ? parseTerms(text) : null;

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-accent" aria-hidden="true" />
          Terms and Conditions{version ? ` · v${version}` : ""}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Decline
          </Button>
          <Button
            size="sm"
            disabled={!text}
            onClick={() => {
              onAccept();
              onClose();
            }}
          >
            I Accept
          </Button>
        </>
      }
    >
      <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border bg-bg-subtle/40 p-4">
        {!parsed ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">{parsed.title}</p>
            <ol className="space-y-3.5">
              {parsed.clauses.map((clause, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-[11px] font-semibold text-accent">
                    {i + 1}
                  </span>
                  <span>{clause}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Modal>
  );
}

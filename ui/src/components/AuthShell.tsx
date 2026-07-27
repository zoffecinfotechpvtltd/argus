import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArgusLogo } from "./ArgusLogo";

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
};

export const fieldVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
};

export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

/** Shared shell for Login, Setup, Signup, and the two password-reset screens, per
 * steps/05-page-specs.md §11: a single centered card on the flat `--color-bg-canvas` background —
 * no split-panel hero art, no pulse-trace motif, one small logo mark at the top of the card. Every
 * screen renders the exact same shell and differs only in the form content passed as children, so
 * the five pages stay pixel-identical in dimensions and spacing. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-canvas px-4 py-12">
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="w-full max-w-sm rounded-lg border border-border bg-bg-surface p-8 shadow-md"
      >
        <ArgusLogo size="sm" className="mb-6" />
        {children}
      </motion.div>
    </div>
  );
}

/** A small uppercase, wide-tracked mono tag — the signature "eyebrow" line every auth screen
 * opens with, in `font-mono` (Geist Mono) for a genuine typeface contrast against the heading. */
export function AuthEyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-2 font-mono text-2xs font-medium uppercase tracking-[0.2em] text-accent">{children}</p>;
}

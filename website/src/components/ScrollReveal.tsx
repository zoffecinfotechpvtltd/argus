import { motion } from "framer-motion";
import type { ReactNode } from "react";

/** Shared scroll-in-view wrapper — one entrance style used everywhere so motion stays consistent
 * rather than every section inventing its own. Fires once (viewport.once) so it never re-plays
 * while scrolling back and forth. */
export function ScrollReveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

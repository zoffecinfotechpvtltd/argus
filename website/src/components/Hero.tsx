import { motion } from "framer-motion";
import { ProductShot } from "./ProductShot";
import { Atmosphere } from "./Atmosphere";
import { SITE } from "../config";

const easeOut = [0.16, 1, 0.3, 1] as const;

export function Hero({ downloadUrl }: { downloadUrl: string }) {
  return (
    <section id="top" className="relative overflow-hidden bg-canvas pb-8 pt-20 sm:pt-28">
      <Atmosphere />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOut }}
          className="text-sm font-medium text-accent"
        >
          {SITE.companyName ? `${SITE.companyName} · ` : ""}Network monitoring
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.06, ease: easeOut }}
          className="mt-4 font-display text-[clamp(2.6rem,7vw,4.6rem)] font-bold leading-[1.04] tracking-tight text-fog"
        >
          See every device.
          <br />
          Know the instant one goes dark.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12, ease: easeOut }}
          className="mx-auto mt-6 max-w-xl text-lg text-muted"
        >
          Argus watches every router, server, and access point on your network, and tells the right person the
          moment one goes down — before a customer has to tell you first.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18, ease: easeOut }}
          className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <a
            href={downloadUrl}
            download
            className="inline-flex cursor-pointer items-center rounded-full bg-accent px-6 py-3 text-base font-semibold text-accent-text-on transition-colors hover:bg-accent-hover"
          >
            Download for Windows
          </a>
          <a
            href="#pricing"
            className="inline-flex cursor-pointer items-center rounded-full border border-border px-6 py-3 text-base font-semibold text-fog transition-colors hover:border-dim"
          >
            See pricing
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.26 }}
          className="mt-4 text-sm text-dim"
        >
          Windows 10/11, 64-bit
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.3, ease: easeOut }}
        className="relative mx-auto mt-14 max-w-5xl px-6"
      >
        {/* The one lit thing in the room: a soft accent glow behind the screenshot, standing in
            for the shadow a light-flagship page would use — shadows don't read on a near-black
            canvas, but a glow does, and it's a more honest metaphor for a monitoring dashboard
            anyway. */}
        <div className="absolute inset-x-12 -top-6 bottom-0 -z-10 rounded-[40px] bg-accent/20 blur-[90px]" aria-hidden="true" />
        <ProductShot />
      </motion.div>
    </section>
  );
}

import { motion } from "framer-motion";
import { Download, ShieldCheck, WifiOff, Server } from "lucide-react";
import { TelemetryPanel } from "./TelemetryPanel";
import { ArgusMark } from "./ArgusMark";
import { SITE } from "../config";

const BADGES = [
  { icon: WifiOff, label: "No cloud dependency" },
  { icon: Server, label: "Runs as a Windows service" },
  { icon: ShieldCheck, label: "Data never leaves the machine" },
];

const easeOut = [0.16, 1, 0.3, 1] as const;

export function Hero({ downloadUrl, version, sizeMb }: { downloadUrl: string; version: string; sizeMb: string }) {
  return (
    <section id="top" className="relative overflow-hidden bg-canvas pt-16">
      <div
        className="pointer-events-none absolute -right-24 top-8 opacity-[0.05]"
        style={{ width: 560, height: 560 }}
        aria-hidden="true"
      >
        <ArgusMark size={560} className="h-full w-full" />
      </div>

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 py-20 lg:grid-cols-2 lg:py-28">
        <div className="text-center lg:text-left">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: easeOut }}
            className="inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.16em] text-accent"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {SITE.companyName ? `${SITE.companyName} · ` : ""}Network Monitoring System
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: easeOut }}
            className="mt-5 font-display text-[clamp(2.1rem,5vw,3.6rem)] font-bold leading-[1.08] text-fog"
          >
            See every device.
            <br />
            <span className="text-accent">Know the instant one goes dark.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16, ease: easeOut }}
            className="mx-auto mt-6 max-w-xl text-lg text-muted lg:mx-0"
          >
            Argus watches every router, server, and access point on your network around the clock, and tells the right person
            the moment one goes down — before a customer has to tell you first. Real ICMP, TCP, HTTP/HTTPS, and SNMP checks
            underneath, a background Windows service you never have to think about on top. No cloud, no account, your data
            never leaves the machine.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24, ease: easeOut }}
            className="mt-9 flex flex-col items-center gap-4 lg:items-start"
          >
            <a
              href={downloadUrl}
              download
              className="inline-flex cursor-pointer items-center gap-3 rounded-lg bg-accent px-7 py-4 text-base font-bold text-accent-text-on transition-colors hover:bg-accent-hover"
            >
              <Download size={19} strokeWidth={2.6} aria-hidden="true" />
              Download for Windows
            </a>
            <p className="font-mono text-xs text-dim">
              v{version} · {sizeMb} MB · Windows 10/11, 64-bit ·{" "}
              <a href="#pricing" className="underline decoration-dashed underline-offset-2 hover:text-accent">
                see pricing
              </a>
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.32, ease: easeOut }}
            className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:justify-start"
          >
            {BADGES.map((b) => (
              <span key={b.label} className="flex items-center gap-1.5 text-xs font-medium text-dim">
                <b.icon size={13} className="text-accent-secondary" aria-hidden="true" />
                {b.label}
              </span>
            ))}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: easeOut }}
          className="mx-auto w-full max-w-md"
        >
          <TelemetryPanel variant="hero" />
        </motion.div>
      </div>
    </section>
  );
}

import { ArgusMark } from "./ArgusMark";
import { SITE } from "../config";

export function Footer({ downloadUrl, version, builtDate }: { downloadUrl: string; version: string; builtDate: string }) {
  const companyLinks = [
    ...(SITE.companyName && SITE.companyUrl ? [{ href: SITE.companyUrl, label: SITE.companyName }] : []),
    { href: `mailto:${SITE.contactEmail}`, label: SITE.contactEmail },
  ];
  return (
    <footer className="border-t border-border bg-canvas pt-10">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 gap-8 pb-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <a href="#top" className="flex items-center gap-2.5">
              <ArgusMark size={24} />
              <span className="font-display text-base font-extrabold tracking-[0.08em] text-fog">ARGUS</span>
            </a>
            <p className="mt-3.5 max-w-[32ch] text-[13.5px] text-muted">
              Discovery, real checks, tiered escalation, and reporting — self-hosted, one Windows service, your data
              never leaves the machine.
            </p>
          </div>
          <FooterCol title="Product" links={[{ href: "#features", label: "Features" }, { href: "#alerting", label: "Alerting" }, { href: "#faq", label: "FAQ" }]} />
          <FooterCol title="Download" links={[{ href: downloadUrl, label: "For Windows", download: true }, { href: "#pricing", label: "Pricing" }]} />
          <FooterCol title="Company" links={companyLinks} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-6 font-mono text-xs text-dim">
          <span>© {SITE.companyName || "Argus"}</span>
          <span>
            v{version} · built {builtDate}
          </span>
        </div>
      </div>

      <div className="select-none overflow-hidden border-t border-border py-4 text-center" aria-hidden="true">
        <span
          className="font-display font-extrabold leading-none tracking-tight text-fog/[0.05]"
          style={{ fontSize: "clamp(4rem, 18vw, 13rem)" }}
        >
          ARGUS
        </span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string; download?: boolean }[] }) {
  return (
    <div>
      <h4 className="mb-3.5 font-display text-xs font-bold uppercase tracking-[0.08em] text-muted">{title}</h4>
      <div className="grid gap-2.5">
        {links.map((l) => (
          <a key={l.label} href={l.href} download={l.download} className="text-[13.5px] text-dim transition-colors hover:text-accent">
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

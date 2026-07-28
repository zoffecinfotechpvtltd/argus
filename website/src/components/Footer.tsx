import { ArgusMark } from "./ArgusMark";
import { SITE } from "../config";

export function Footer({ downloadUrl }: { downloadUrl: string }) {
  const companyLinks = [
    ...(SITE.companyName && SITE.companyUrl ? [{ href: SITE.companyUrl, label: SITE.companyName }] : []),
    { href: `mailto:${SITE.contactEmail}`, label: SITE.contactEmail },
  ];
  return (
    <footer className="border-t border-border bg-canvas">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <FooterCol title="Product" links={[{ href: "#features", label: "Features" }, { href: "#alerting", label: "Alerting" }, { href: "#faq", label: "FAQ" }]} />
          <FooterCol title="Download" links={[{ href: downloadUrl, label: "For Windows", download: true }, { href: "#pricing", label: "Pricing" }]} />
          <FooterCol title="Company" links={companyLinks} />
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <a href="#top" className="flex items-center gap-2">
            <ArgusMark size={16} />
            <span className="font-display text-[13px] font-semibold tracking-tight text-muted">Argus</span>
          </a>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-dim">
            <span>© {SITE.companyName || "Argus"}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string; download?: boolean }[] }) {
  return (
    <div>
      <h4 className="mb-3 text-[12px] font-semibold text-fog">{title}</h4>
      <div className="grid gap-2">
        {links.map((l) => (
          <a key={l.label} href={l.href} download={l.download} className="text-[13px] text-muted transition-colors hover:text-fog">
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

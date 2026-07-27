import { ArgusMark } from "./ArgusMark";

/** Icon + wordmark lockup. The wordmark is set in the brand display face (Bricolage Grotesque, wide
 * tracking) rather than baked into an image — see ArgusMark.tsx for why the icon itself is a
 * redrawn SVG rather than the source PNG. */
export function ArgusLogo({ size = "md", sweep = false, tagline = false, className = "" }: { size?: "sm" | "md" | "lg"; sweep?: boolean; tagline?: boolean; className?: string }) {
  const markSize = size === "sm" ? 24 : size === "lg" ? 40 : 30;
  const textSize = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <ArgusMark size={markSize} sweep={sweep} />
      <span className="flex flex-col leading-none">
        <span className={`font-display font-bold tracking-[0.08em] text-text-primary ${textSize}`}>ARGUS</span>
        {tagline && <span className="mt-1 font-mono text-2xs font-medium uppercase tracking-[0.22em] text-text-secondary">Network Monitoring System</span>}
      </span>
    </span>
  );
}

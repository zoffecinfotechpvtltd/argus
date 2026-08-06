import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert, OctagonX } from "lucide-react";
import { api } from "../api/client";

interface LicenseSummary {
  status: "unlicensed" | "valid" | "grace" | "expired" | "invalid" | "not_applicable";
  deviceLimit?: number;
  deviceCount?: number;
  graceDaysLeft?: number | null;
}

/** Admin-only, exe-mode-only heads-up when a license needs attention. Silent (renders nothing)
 * once things are fine, on saas mode, or before the first fetch resolves — never blocks the app. */
export function LicenseBanner() {
  const [info, setInfo] = useState<LicenseSummary | null>(null);

  useEffect(() => {
    api
      .get<LicenseSummary>("/license")
      .then(setInfo)
      .catch(() => {});
  }, []);

  if (!info || info.status === "not_applicable") return null;

  const nearTrialLimit = info.status === "unlicensed" && (info.deviceLimit ?? 0) < 1e9 && (info.deviceCount ?? 0) >= (info.deviceLimit ?? 0) - 1;
  if (info.status === "valid" || (info.status === "unlicensed" && !nearTrialLimit)) return null;

  const text =
    info.status === "grace"
      ? `License renewal is overdue${info.graceDaysLeft !== null ? ` — ${info.graceDaysLeft} day${info.graceDaysLeft === 1 ? "" : "s"} left in the grace period` : ""}.`
      : info.status === "expired"
        ? `License expired — Argus is capped at ${info.deviceLimit} devices until you renew.`
        : info.status === "invalid"
          ? "The applied license file is invalid."
          : `Trial mode: ${info.deviceCount}/${info.deviceLimit} devices used.`;

  const severe = info.status === "expired" || info.status === "invalid";
  // A trial approaching its device cap isn't a problem yet — it's expected, informational, and
  // (unlike an overdue renewal or an actually-expired/invalid license) not urgent. Grouping it
  // under the same amber "something needs attention" treatment as those genuinely alarming states
  // overstated it every time a brand-new trial install added its 4th or 5th device. It gets the
  // product's own accent color instead — a brand-colored nudge, not a status warning — while grace
  // period and expired/invalid keep their real semantic warning/critical colors untouched.
  const trialApproachingLimit = info.status === "unlicensed";
  const Icon = severe ? OctagonX : TriangleAlert;
  const toneClass = severe
    ? "border-critical/30 bg-critical-subtle text-critical"
    : trialApproachingLimit
      ? "border-accent/30 bg-accent-subtle text-accent"
      : "border-warning/30 bg-warning-subtle text-warning";

  return (
    <div className={`flex items-center justify-center gap-2 border-b px-4 py-1.5 text-center text-xs ${toneClass}`}>
      <Icon size={13} className="shrink-0" aria-hidden="true" />
      <span>{text}</span>
      <Link to="/admin/license" className="underline underline-offset-2 transition-opacity duration-150 hover:opacity-80">
        Manage license
      </Link>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { KeyRound, Upload } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { Badge, Button, Card, CardBody, CardHeader, Skeleton, Textarea, useToast } from "../components/ui";
import type { BadgeTone } from "../components/ui";

// Mirrors @domain/license.ts's LicensePlan — includes the saas-mode tiers (free/pro) alongside
// the original exe-mode ones, same list, kept in sync manually (no shared types package yet).
type LicensePlan = "starter" | "professional" | "business" | "enterprise" | "unlimited" | "free" | "pro";

const PLAN_LABEL: Record<LicensePlan, string> = {
  starter: "Starter",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
  unlimited: "Unlimited",
  free: "Free",
  pro: "Pro",
};

interface LicenseInfo {
  status: "unlicensed" | "valid" | "grace" | "expired" | "invalid";
  customer: string | null;
  plan: LicensePlan | null;
  deviceLimit: number;
  trialDeviceLimit: number;
  expiresAt: string | null;
  graceDaysLeft: number | null;
  invalidReason: string | null;
  deviceCount: number;
}

const STATUS_LABEL: Record<LicenseInfo["status"], string> = {
  unlicensed: "Trial mode",
  valid: "Licensed",
  grace: "Renewal overdue",
  expired: "Expired",
  invalid: "Invalid license file",
};

const EXPIRY_PREFIX: Record<LicenseInfo["status"], string> = {
  unlicensed: "Renews / expires",
  valid: "Renews / expires",
  grace: "Renewal was due",
  expired: "Expired",
  invalid: "Renews / expires",
};

const STATUS_TONE: Record<LicenseInfo["status"], BadgeTone> = {
  unlicensed: "neutral",
  valid: "success",
  grace: "warning",
  expired: "critical",
  invalid: "critical",
};

export function SettingsLicense() {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [applying, setApplying] = useState(false);
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLicenseKey((await file.text()).trim());
    } catch {
      toast.error("Couldn't read that file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function refresh() {
    api.get<LicenseInfo>("/license").then(setInfo).catch(() => {});
  }

  useEffect(refresh, []);

  async function apply() {
    if (!licenseKey.trim()) return;
    setApplying(true);
    try {
      await api.post("/license", { licenseKey: licenseKey.trim() });
      toast.success("License applied.");
      setLicenseKey("");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not apply license.");
    } finally {
      setApplying(false);
    }
  }

  if (!info) {
    return (
      <Layout title="License" subtitle="Plan, device limits, and license key">
        <div className="mx-auto max-w-2xl space-y-6">
          <Card>
            <CardBody>
              <div className="mb-4 flex items-center justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </CardBody>
          </Card>
        </div>
      </Layout>
    );
  }

  const usagePct = info.deviceLimit > 0 && info.deviceLimit < 1e9 ? Math.min(100, Math.round((info.deviceCount / info.deviceLimit) * 100)) : 0;

  return (
    <Layout title="License" subtitle="Plan, device limits, and license key">
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardBody>
            <CardHeader title="License" action={<Badge tone={STATUS_TONE[info.status]}>{STATUS_LABEL[info.status]}</Badge>} />

            <div className="space-y-2 text-sm text-text-secondary">
              {info.customer && (
                <p>
                  Licensed to <span className="font-medium text-text-primary">{info.customer}</span>
                  {info.plan && <span> · {PLAN_LABEL[info.plan]} plan</span>}
                </p>
              )}
              {!info.customer && <p>No license applied — running in trial mode.</p>}

              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>Devices</span>
                  <span className="tabular-nums">
                    {info.deviceCount} / {info.deviceLimit >= 1e9 ? "unlimited" : info.deviceLimit}
                  </span>
                </div>
                {info.deviceLimit < 1e9 && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${usagePct >= 100 ? "bg-critical" : usagePct >= 80 ? "bg-warning" : "bg-accent"}`}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                )}
              </div>

              {info.expiresAt &&
                (() => {
                  const daysLeft = Math.ceil((new Date(info.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                  const soon = info.status === "valid" && daysLeft <= 14;
                  const countdown = daysLeft <= 0 ? "today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
                  return (
                    <p className={`text-xs ${soon ? "font-medium text-warning" : ""}`}>
                      {EXPIRY_PREFIX[info.status]} {new Date(info.expiresAt).toLocaleDateString()}
                      {soon && ` — ${countdown}`}
                    </p>
                  );
                })()}

              {info.status === "grace" && (
                <p className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning">
                  Your license expired {info.graceDaysLeft !== null ? GRACE_LABEL(info.graceDaysLeft) : ""} — monitoring keeps running at full capacity
                  during the grace period. Renew to avoid being dropped to the {info.trialDeviceLimit}-device trial cap.
                </p>
              )}
              {info.status === "expired" && (
                <p className="rounded-md border border-critical/30 bg-critical-subtle px-3 py-2 text-xs text-critical">
                  Your license has expired and the grace period has passed. Argus is now capped at {info.trialDeviceLimit} devices until you renew.
                </p>
              )}
              {info.status === "unlicensed" && (
                <p className="rounded-md border border-border bg-bg-subtle/60 px-3 py-2 text-xs">
                  Trial mode allows up to {info.trialDeviceLimit} devices. Contact sales for a license to unlock more.
                </p>
              )}
              {info.status === "invalid" && info.invalidReason && (
                <p className="rounded-md border border-critical/30 bg-critical-subtle px-3 py-2 text-xs text-critical">{info.invalidReason}</p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <KeyRound size={16} className="text-accent" aria-hidden="true" />
                  Apply a license
                </span>
              }
              description={
                <>
                  Paste the contents of the <code>.license.key</code> file you received after purchase, or upload it directly.
                </>
              }
              action={
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-2xs font-medium text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary">
                  <Upload size={12} aria-hidden="true" />
                  Upload file
                  <input ref={fileInputRef} type="file" accept=".key,.license.key,.txt" onChange={handleFile} className="hidden" />
                </label>
              }
            />
            <Textarea className="h-28 w-full font-mono text-xs" placeholder="Paste license key…" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} />
            <div className="mt-3">
              <Button onClick={apply} disabled={applying || !licenseKey.trim()}>
                {applying ? "Applying…" : "Apply license"}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}

function GRACE_LABEL(daysLeft: number): string {
  return daysLeft <= 0 ? "— grace period ends today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} ago`;
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, AlertTriangle, XCircle, Ghost } from "lucide-react";
import { api } from "../api/client";
import { StatusDot } from "../components/StatusDot";
import { Badge, Card, EmptyState } from "../components/ui";
import type { BadgeTone } from "../components/ui";
import { ArgusLogo } from "../components/ArgusLogo";
import { SEVERITY_HEX, type AlertSeverity } from "../lib/statusTokens";

interface PublicDeviceStatus {
  id: string;
  name: string;
  state: string;
}

interface PublicGroupStatus {
  id: string;
  name: string;
  devices: PublicDeviceStatus[];
}

interface PublicIncident {
  title: string;
  severity: string;
  openedAt: string;
  resolvedAt: string | null;
}

type OverallState = "operational" | "degraded" | "outage";

interface PublicStatusPageResponse {
  tenantName: string;
  title: string;
  overallState: OverallState;
  groups: PublicGroupStatus[];
  ungrouped: PublicDeviceStatus[];
  recentIncidents: PublicIncident[];
}

const OVERALL_COPY: Record<OverallState, { label: string; icon: typeof CheckCircle2; tone: "success" | "warning" | "critical" }> = {
  operational: { label: "All systems operational", icon: CheckCircle2, tone: "success" },
  degraded: { label: "Some systems degraded", icon: AlertTriangle, tone: "warning" },
  outage: { label: "Active outage", icon: XCircle, tone: "critical" },
};

/** Worst state among a group's devices, so the group header can carry one summary pill rather
 * than making a visitor scan every device row to judge the group as a whole. */
function groupState(devices: PublicDeviceStatus[]): { label: string; tone: BadgeTone } {
  if (devices.some((d) => d.state === "down")) return { label: "Outage", tone: "critical" };
  if (devices.some((d) => d.state === "degraded" || d.state === "flapping")) return { label: "Degraded", tone: "warning" };
  return { label: "Operational", tone: "success" };
}

function DeviceRow({ device }: { device: PublicDeviceStatus }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="truncate text-sm text-text-primary">{device.name}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs capitalize text-text-secondary">
        {device.state}
        <StatusDot state={device.state} pulse={device.state === "down" || device.state === "flapping"} />
      </span>
    </div>
  );
}

/**
 * Public, unauthenticated status page — the one screen in this app rendered outside the logged-in
 * shell. Fetches `/api/status-page/:tenantSlug`, which already redacts everything except device
 * name + up/down/degraded state before this component ever sees it (src/application/statusPage.ts).
 *
 * Per steps/05-page-specs.md §10: deliberately does NOT reuse the auth pages' motif (no grain
 * texture, no EKG pulse-trace) — a customer landing here mid-incident should see something calm
 * and plain, not the same decorative treatment as a login screen.
 */
export function StatusPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [page, setPage] = useState<PublicStatusPageResponse | null | "not-found">(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!tenantSlug) return;
    let cancelled = false;
    api
      .get<PublicStatusPageResponse>(`/status-page/${tenantSlug}`)
      .then((res) => {
        if (!cancelled) {
          setPage(res);
          setLoadedAt(new Date());
        }
      })
      .catch(() => {
        // Any failure (404 disabled/unknown tenant, network error) reads the same to an anonymous
        // visitor — there's nothing actionable to distinguish for them.
        if (!cancelled) setPage("not-found");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-bg-canvas px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <div className="mb-10 flex justify-center">
          <ArgusLogo size="sm" />
        </div>

        {page === null ? (
          <Card className="overflow-hidden p-6 text-center">
            <span className="text-sm font-medium text-text-secondary">Checking status…</span>
          </Card>
        ) : page === "not-found" ? (
          <EmptyState icon={Ghost} title="No status page here" description="This link isn't live, or the page hasn't been set up yet." />
        ) : (
          <StatusPageBody page={page} loadedAt={loadedAt} mounted={mounted} />
        )}
      </div>
    </div>
  );
}

function StatusPageBody({ page, loadedAt, mounted }: { page: PublicStatusPageResponse; loadedAt: Date | null; mounted: boolean }) {
  const overall = OVERALL_COPY[page.overallState];
  const OverallIcon = overall.icon;
  const hasAnyDevices = page.groups.length > 0 || page.ungrouped.length > 0;
  const toneTextClass = overall.tone === "success" ? "text-success" : overall.tone === "warning" ? "text-warning" : "text-critical";

  return (
    <div
      className={`space-y-8 transition-all duration-300 ease-out-expo ${mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
    >
      <div className="text-center">
        <p className="text-2xs font-medium uppercase tracking-tight text-text-muted">{page.tenantName}</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tightest text-text-primary sm:text-3xl">{page.title}</h1>
      </div>

      {/* One large, plain banner — the calm, trustworthy focal point this page needs, not a
          decorative motif. */}
      <Card className="p-8 text-center">
        <OverallIcon size={32} className={toneTextClass} aria-hidden="true" />
        <p className={`mt-3 text-lg font-semibold ${toneTextClass}`}>{overall.label}</p>
        {loadedAt && <p className="mt-1.5 text-2xs text-text-muted">Checked as of {loadedAt.toLocaleTimeString()}</p>}
      </Card>

      {!hasAnyDevices ? (
        <EmptyState icon={Ghost} title="Nothing to show yet" description="No services have been published to this status page." />
      ) : (
        <div className="space-y-4">
          {page.groups.map((g) => {
            const state = groupState(g.devices);
            return (
              <Card key={g.id} className="p-4 sm:p-5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-tight text-text-secondary">{g.name}</span>
                  <Badge tone={state.tone}>{state.label}</Badge>
                </div>
                <div className="divide-y divide-border">
                  {g.devices.map((d) => (
                    <DeviceRow key={d.id} device={d} />
                  ))}
                </div>
              </Card>
            );
          })}
          {page.ungrouped.length > 0 && (
            <Card className="p-4 sm:p-5">
              {page.groups.length > 0 && (
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-tight text-text-secondary">Other</span>
                  <Badge tone={groupState(page.ungrouped).tone}>{groupState(page.ungrouped).label}</Badge>
                </div>
              )}
              <div className="divide-y divide-border">
                {page.ungrouped.map((d) => (
                  <DeviceRow key={d.id} device={d} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {page.recentIncidents.length > 0 && (
        <Card className="p-4 sm:p-5">
          <div className="mb-3 text-2xs font-semibold uppercase tracking-tight text-text-secondary">Recent incidents</div>
          {/* Same connecting-rule timeline pattern as AuditLog (steps/05-page-specs.md §10:
              "incident history list below using the AuditLog timeline pattern"). */}
          <div className="relative">
            {page.recentIncidents.length > 1 && (
              <div className="absolute bottom-3 left-[5px] top-2 w-px bg-border" aria-hidden="true" />
            )}
            <div className="space-y-4">
              {page.recentIncidents.map((incident, i) => {
                const color = SEVERITY_HEX[incident.severity as AlertSeverity] ?? SEVERITY_HEX.info;
                return (
                  <div key={i} className="relative flex gap-3">
                    <span
                      className="relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-bg-surface"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="truncate text-sm text-text-primary">{incident.title}</span>
                        <span className="shrink-0 font-mono text-2xs text-text-muted">{new Date(incident.openedAt).toLocaleDateString()}</span>
                      </div>
                      <span className="text-2xs text-text-secondary">{incident.resolvedAt ? "Resolved" : "Open"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <p className="pt-2 text-center text-2xs text-text-muted">Powered by {page.tenantName} · Argus status</p>
    </div>
  );
}

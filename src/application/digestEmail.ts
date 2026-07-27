import { DEFAULT_TENANT_ID } from "@domain/entities";
import { generateSlaReport } from "@application/reports";
import type { AppContainer } from "@ports/context";

export interface DigestEmail {
  subject: string;
  text: string;
  html: string;
}

/** Shared content builder for both the per-user opt-in digest and the admin-configured
 * instance-wide scheduled report — same "how's the fleet doing" summary, just addressed to
 * different recipients on potentially different cadences. */
export async function buildDigestEmail(app: AppContainer, periodDays: number): Promise<DigestEmail> {
  const to = app.clock.now();
  const from = new Date(to.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const slaRows = await generateSlaReport(app, DEFAULT_TENANT_ID, { fromIso: from.toISOString(), toIso: to.toISOString() });
  const worst = [...slaRows].sort((a, b) => a.availabilityPct - b.availabilityPct).slice(0, 5);
  const openAlerts = await app.repos.alert.countOpenBySeverity(DEFAULT_TENANT_ID);
  const period = periodDays === 1 ? "daily" : "weekly";

  const subject = `Argus ${period} summary — ${openAlerts.critical ?? 0} critical, ${openAlerts.warning ?? 0} warning open`;

  const worstLines = worst.length > 0 ? worst.map((r) => `${r.deviceName}: ${r.availabilityPct}%`).join("\n") : "No devices with recorded downtime.";
  const text = `Argus ${period} summary\n\nOpen alerts: ${openAlerts.critical ?? 0} critical, ${openAlerts.warning ?? 0} warning, ${openAlerts.info ?? 0} info.\n\nLowest availability devices (last ${periodDays}d):\n${worstLines}`;

  const worstHtml =
    worst.length > 0
      ? `<ul>${worst.map((r) => `<li>${r.deviceName}: ${r.availabilityPct}%</li>`).join("")}</ul>`
      : "<p>No devices with recorded downtime.</p>";
  const html = `<h2>Argus ${period} summary</h2><p>Open alerts: <b>${openAlerts.critical ?? 0}</b> critical, <b>${openAlerts.warning ?? 0}</b> warning, ${openAlerts.info ?? 0} info.</p><h3>Lowest availability devices (last ${periodDays}d)</h3>${worstHtml}`;

  return { subject, text, html };
}

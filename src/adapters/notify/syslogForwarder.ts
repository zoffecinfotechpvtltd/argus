import { createSocket } from "node:dgram";
import type { AlertSeverity } from "@domain/entities";
import type { Logger, SyslogForwarder } from "@ports/services";
import type { SettingsRepo } from "@ports/repos";

export const SYSLOG_SETTINGS_KEY = "alerts.syslogForward";

export interface SyslogConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** Standard syslog facility number (RFC 5424) — 16-23 ("local0"-"local7") are the conventional
   * choice for application-defined use, which is why that's the default a fresh config gets. */
  facility: number;
}

function cefSeverity(severity: AlertSeverity): number {
  // CEF's Severity field is 0-10; Argus only has 3 tiers, so they're spread to roughly match how
  // most SIEMs bucket CEF severity into Low/Medium/High/Very-High for their own dashboards.
  return severity === "critical" ? 10 : severity === "warning" ? 6 : 3;
}

/** ArcSight Common Event Format — the de facto standard most SIEMs (Splunk, QRadar, ArcSight
 * itself, Sentinel via a CEF connector) can parse without a custom integration. */
export function buildCefMessage(
  alert: { title: string; severity: AlertSeverity; deviceId: string; conditionKey: string },
  deviceName: string
): string {
  const ext = `deviceId=${alert.deviceId} dvchost=${deviceName} cs1Label=condition cs1=${alert.conditionKey}`;
  return `CEF:0|Argus|NMS|1.0|${alert.conditionKey}|${alert.title}|${cefSeverity(alert.severity)}|${ext}`;
}

/** Fire-and-forget UDP syslog send — SIEM forwarding is best-effort telemetry, not a delivery
 * guarantee (unlike the email/webhook notifiers, there's no retry or notificationLog entry for
 * this channel); a dropped UDP packet just means one less duplicate copy of data that's still
 * fully visible in the Argus UI itself. */
export function sendSyslog(config: SyslogConfig, cefMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const priority = config.facility * 8 + 6; // severity fixed at "info" (6) for the syslog PRI — CEF's own Severity field carries the real signal
    const packet = `<${priority}>${new Date().toISOString()} argus CEF: ${cefMessage}`;
    const buf = Buffer.from(packet, "utf-8");
    socket.send(buf, config.port, config.host, (err) => {
      socket.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

/** `SyslogForwarder` port implementation — every newly-opened alert is forwarded here regardless
 * of per-user routing, rate-limiting, storm buffering, or uplink-dependency suppression; a SIEM
 * wants the complete, unfiltered stream to do its own correlation, which is a different job than
 * protecting a human's inbox from noise. Called from AlertEngine right after an alert is created. */
export class DefaultSyslogForwarder implements SyslogForwarder {
  constructor(
    private settings: SettingsRepo,
    private logger: Logger
  ) {}

  async forward(
    tenantId: string,
    alert: { title: string; severity: AlertSeverity; deviceId: string; conditionKey: string },
    deviceName: string
  ): Promise<void> {
    try {
      const raw = await this.settings.get(tenantId, SYSLOG_SETTINGS_KEY);
      if (!raw) return;
      const config: SyslogConfig = JSON.parse(raw);
      if (!config.enabled) return;
      await sendSyslog(config, buildCefMessage(alert, deviceName));
    } catch (err) {
      this.logger.error("syslog_forward_failed", { alertId: alert.conditionKey, deviceId: alert.deviceId, error: (err as Error).message });
    }
  }
}

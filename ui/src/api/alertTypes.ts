export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  tenantId: string;
  deviceId: string;
  conditionKey: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: string | null;
  openedAt: string;
  lastSeenAt: string;
  ackedBy: string | null;
  ackedAt: string | null;
  resolvedAt: string | null;
  escalationStep: number;
}

export interface NotificationPrefs {
  userId: string;
  tenantId: string;
  channels: Array<"email" | "webhook">;
  severityFloor: AlertSeverity;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  webhookUrl: string | null;
  digestRecurrence: "daily" | "weekly" | null;
}

// Re-exported from lib/statusTokens (the single source of truth) so existing `from "./alertTypes"`
// imports across the app keep working unchanged. `info` used to be emerald/green here — the same
// hue as this app's accent color — which is exactly the "semantic color doubling as the accent"
// mixing a design system should avoid; it's a distinct blue now.
export { SEVERITY_HEX, SEVERITY_CLASS as SEVERITY_COLOR } from "../lib/statusTokens";

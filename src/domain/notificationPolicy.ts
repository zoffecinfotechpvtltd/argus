// Pure — no I/O. Decides whether a given alert severity clears a user's notification preferences.
import type { AlertSeverity } from "@domain/entities";

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };

export function meetsSeverityFloor(severity: AlertSeverity, floor: AlertSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[floor];
}

/** HH:MM 24h strings. Handles overnight ranges (e.g. 22:00-07:00). */
export function isWithinQuietHours(nowHHMM: string, startHHMM: string, endHHMM: string): boolean {
  if (startHHMM <= endHHMM) return nowHHMM >= startHHMM && nowHHMM < endHHMM;
  return nowHHMM >= startHHMM || nowHHMM < endHHMM;
}

export interface NotificationDecisionInput {
  severity: AlertSeverity;
  severityFloor: AlertSeverity;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  nowHHMM: string;
}

/**
 * Non-critical alerts are suppressed during quiet hours (simplification: dropped rather than
 * queued as a digest — see PROGRESS.md). Critical alerts always page through regardless of hours.
 */
export function shouldNotifyNow(input: NotificationDecisionInput): boolean {
  if (!meetsSeverityFloor(input.severity, input.severityFloor)) return false;
  if (input.severity === "critical") return true;
  if (input.quietHoursStart && input.quietHoursEnd && isWithinQuietHours(input.nowHHMM, input.quietHoursStart, input.quietHoursEnd)) {
    return false;
  }
  return true;
}

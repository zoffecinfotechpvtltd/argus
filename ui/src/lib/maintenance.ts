// Client-side mirror of @domain/maintenance.ts's isWindowActiveAt/maintenanceWindowStatus — used
// only to label a window "Active now"/"Upcoming"/"Expired" in the UI; the server's own copy is the
// actual authority on whether a device is suppressed, this is display-only (same reasoning as the
// isPublicIpv4 mirror in Inventory.tsx).
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const RECURRENCE_PERIOD_MS: Record<string, number> = { daily: DAY_MS, weekly: WEEK_MS };

interface WindowLike {
  startsAt: string;
  endsAt: string;
  recurrence: string | null;
}

export function isWindowActiveAt(window: WindowLike, atIso: string): boolean {
  const at = new Date(atIso).getTime();
  const start = new Date(window.startsAt).getTime();
  const end = new Date(window.endsAt).getTime();
  if (at < start) return false;

  const periodMs = window.recurrence ? RECURRENCE_PERIOD_MS[window.recurrence] : undefined;
  if (!periodMs) return at <= end;

  const durationMs = end - start;
  const cyclePos = (at - start) % periodMs;
  return cyclePos <= durationMs;
}

export type MaintenanceWindowStatus = "active" | "upcoming" | "expired";

export function maintenanceWindowStatus(window: WindowLike, atIso: string): MaintenanceWindowStatus {
  if (isWindowActiveAt(window, atIso)) return "active";
  const at = new Date(atIso).getTime();
  const start = new Date(window.startsAt).getTime();
  if (at < start) return "upcoming";
  return window.recurrence ? "upcoming" : "expired";
}

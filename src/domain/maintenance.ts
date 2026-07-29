// Pure — no I/O, no hidden Date.now(); "now" always comes in as an argument.
import type { MaintenanceWindow } from "@domain/entities";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Fixed catalogue of supported recurrence periods. Anything else stored in `recurrence` (there is
 * no DB-level CHECK constraint on this free-text column) is treated as "no recurrence" rather than
 * silently guessed at — a window with an unrecognized recurrence string still honors its one literal
 * startsAt..endsAt occurrence instead of looping forever on an assumption. */
const RECURRENCE_PERIOD_MS: Record<string, number> = { daily: DAY_MS, weekly: WEEK_MS };

/**
 * True if `window` is active at `atIso`, expanding `recurrence` if set. Previously `recurrence` was
 * stored but never read anywhere (the SQL-level `listActive` query only ever checked the literal
 * starts_at/ends_at of the single stored occurrence) — a "weekly" window someone saved would never
 * actually recur. This is the fix: the window's original `[startsAt, endsAt)` duration is preserved,
 * and re-applied every `recurrence` period starting from `startsAt`, forever (until the window row
 * itself is deleted — there is no separate recurrence end date).
 */
export function isWindowActiveAt(window: MaintenanceWindow, atIso: string): boolean {
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

export function isDeviceInMaintenance(windows: MaintenanceWindow[], deviceId: string, groupId: string | null, atIso: string): boolean {
  return windows.some((w) => (w.deviceId === deviceId || (w.groupId !== null && w.groupId === groupId)) && isWindowActiveAt(w, atIso));
}

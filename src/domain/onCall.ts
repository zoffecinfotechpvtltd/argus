// Pure — no I/O. On-call rotation math for M4's escalation-matrix milestone.
import type { OnCallSchedule } from "@domain/entities";

/**
 * Whoever's shift covers `atIso`, cycling through `schedule.userIds` in order every
 * `shiftLengthHours` starting from `rotationStartAt`. Before the rotation has started, the first
 * person in the list is considered on call (there's no "no one's on call yet" state — a schedule
 * that exists is always covering someone). Null only when the schedule has no members at all.
 */
export function getOnCallUserId(schedule: OnCallSchedule, atIso: string): string | null {
  if (schedule.userIds.length === 0) return null;

  const startMs = new Date(schedule.rotationStartAt).getTime();
  const atMs = new Date(atIso).getTime();
  if (atMs <= startMs) return schedule.userIds[0]!;

  const shiftMs = schedule.shiftLengthHours * 60 * 60 * 1000;
  if (shiftMs <= 0) return schedule.userIds[0]!;

  const elapsedShifts = Math.floor((atMs - startMs) / shiftMs);
  const idx = elapsedShifts % schedule.userIds.length;
  return schedule.userIds[idx]!;
}

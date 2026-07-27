import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { DeviceGroup, OnCallSchedule } from "../api/types";
import { CATEGORICAL_PALETTE } from "../lib/statusTokens";
import { Button, FieldGroup, Input, Modal, Select, useConfirm, useToast } from "./ui";

interface RotationUser {
  id: string;
  email: string;
  disabled: boolean;
}

interface RotationForm {
  userIds: string[];
  shiftLengthHours: number;
  rotationStartAtLocal: string;
}

const PERIOD_OPTIONS = [
  { value: 7, label: "Next 7 days" },
  { value: 14, label: "Next 14 days" },
  { value: 30, label: "Next 30 days" },
];

function emptyForm(): RotationForm {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return { userIds: [], shiftLengthHours: 24, rotationStartAtLocal: toLocalInputValue(now) };
}

/** `<input type="datetime-local">` wants "YYYY-MM-DDTHH:mm" in *local* time, with no timezone
 * suffix — Date#toISOString() is UTC, so this converts by hand rather than slicing that string
 * (which would silently shift the displayed time for anyone not in UTC). */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ShiftSegment {
  start: Date;
  end: Date;
  userIndex: number;
}

/** Walks the rotation forward from `rotationStartAt` in `shiftLengthHours`-long blocks, cycling
 * through `userIds` in order, and returns every block that overlaps [rangeStart, rangeEnd). */
function computeShiftSegments(schedule: { userIds: string[]; shiftLengthHours: number; rotationStartAt: string }, rangeStart: Date, rangeEnd: Date): ShiftSegment[] {
  const segments: ShiftSegment[] = [];
  const userCount = schedule.userIds.length;
  const shiftMs = schedule.shiftLengthHours * 3_600_000;
  const startMs = new Date(schedule.rotationStartAt).getTime();
  if (userCount === 0 || !shiftMs || Number.isNaN(startMs)) return segments;

  let shiftIndex = Math.floor((rangeStart.getTime() - startMs) / shiftMs);
  if (shiftIndex < 0) shiftIndex = 0;
  let cursor = startMs + shiftIndex * shiftMs;

  // Safety valve: never walk more than a few thousand shifts even if inputs are pathological
  // (e.g. a 1-hour shift over a 30-day window is already ~720 iterations — fine; this just stops
  // an unbounded loop from a corrupt/zero shiftMs some other guard missed).
  let guard = 0;
  while (cursor < rangeEnd.getTime() && guard++ < 5000) {
    const segStart = new Date(Math.max(cursor, startMs));
    const segEnd = new Date(cursor + shiftMs);
    if (segEnd.getTime() > rangeStart.getTime() && segStart.getTime() >= startMs) {
      const userIndex = ((shiftIndex % userCount) + userCount) % userCount;
      segments.push({ start: segStart, end: segEnd, userIndex });
    }
    cursor += shiftMs;
    shiftIndex++;
  }
  return segments;
}

function userLabel(users: RotationUser[] | null, id: string): string {
  return users?.find((u) => u.id === id)?.email ?? id;
}

/**
 * On-call rotation editor for one device group (M4) — opened from Inventory's groups panel.
 * Two parts: (1) the rotation form (who's in the rotation and in what order, shift length, when
 * the rotation started) and (2) a read-only calendar-like grid previewing who's on call each day
 * over the selected period, color-coded by person — a grid, not a card list; drawn from the
 * categorical palette since this carries no status meaning.
 */
export function OnCallRotationEditor({ group, users, onClose }: { group: DeviceGroup | null; users: RotationUser[] | null; onClose: () => void }) {
  const [schedule, setSchedule] = useState<OnCallSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<RotationForm>(emptyForm());
  const [addUserId, setAddUserId] = useState("");
  const [periodDays, setPeriodDays] = useState(14);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (!group) {
      setLoaded(false);
      return;
    }
    setLoaded(false);
    api
      .get<OnCallSchedule>(`/groups/${group.id}/oncall-schedule`)
      .then((s) => {
        setSchedule(s);
        setForm({ userIds: [...s.userIds], shiftLengthHours: s.shiftLengthHours, rotationStartAtLocal: toLocalInputValue(new Date(s.rotationStartAt)) });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setSchedule(null);
          setForm(emptyForm());
        } else {
          toast.error("Failed to load the on-call rotation.");
        }
      })
      .finally(() => setLoaded(true));
  }, [group?.id]);

  const availableUsers = useMemo(() => (users ?? []).filter((u) => !u.disabled && !form.userIds.includes(u.id)), [users, form.userIds]);

  function addToRotation() {
    if (!addUserId) return;
    setForm((f) => ({ ...f, userIds: [...f.userIds, addUserId] }));
    setAddUserId("");
  }

  function removeFromRotation(index: number) {
    setForm((f) => ({ ...f, userIds: f.userIds.filter((_, i) => i !== index) }));
  }

  function moveInRotation(index: number, dir: -1 | 1) {
    setForm((f) => {
      const next = [...f.userIds];
      const target = index + dir;
      if (target < 0 || target >= next.length) return f;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...f, userIds: next };
    });
  }

  async function save() {
    if (!group || form.userIds.length === 0) return;
    setSaving(true);
    try {
      const rotationStartAt = new Date(form.rotationStartAtLocal).toISOString();
      if (schedule) {
        const updated = await api.patch<OnCallSchedule>(`/oncall-schedules/${schedule.id}`, {
          userIds: form.userIds,
          shiftLengthHours: form.shiftLengthHours,
          rotationStartAt,
        });
        setSchedule(updated);
      } else {
        const created = await api.post<OnCallSchedule>("/oncall-schedules", {
          groupId: group.id,
          userIds: form.userIds,
          shiftLengthHours: form.shiftLengthHours,
          rotationStartAt,
        });
        setSchedule(created);
      }
      toast.success(`On-call rotation saved for ${group.name}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save the on-call rotation.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!schedule || !group) return;
    const ok = await confirm({
      title: "Remove on-call rotation?",
      message: `Remove the on-call rotation for ${group.name}? Any escalation tier set to "whoever's on call" will have no one to notify until a new rotation is set up.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.delete(`/oncall-schedules/${schedule.id}`);
      setSchedule(null);
      setForm(emptyForm());
      toast.success("On-call rotation removed.");
    } catch {
      toast.error("Failed to remove the on-call rotation.");
    } finally {
      setDeleting(false);
    }
  }

  const rangeStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, [group?.id]);
  const rangeEnd = useMemo(() => new Date(rangeStart.getTime() + periodDays * 86_400_000), [rangeStart, periodDays]);

  const previewSchedule = schedule ?? (form.userIds.length > 0 ? { userIds: form.userIds, shiftLengthHours: form.shiftLengthHours, rotationStartAt: new Date(form.rotationStartAtLocal).toISOString() } : null);
  const segments = useMemo(() => (previewSchedule ? computeShiftSegments(previewSchedule, rangeStart, rangeEnd) : []), [previewSchedule, rangeStart, rangeEnd]);

  const now = Date.now();
  const currentSegment = segments.find((s) => s.start.getTime() <= now && now < s.end.getTime());

  const days = useMemo(() => Array.from({ length: periodDays }, (_, i) => new Date(rangeStart.getTime() + i * 86_400_000)), [rangeStart, periodDays]);

  return (
    <Modal
      open={!!group}
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <CalendarClock size={17} className="text-accent" aria-hidden="true" />
          On-call rotation — {group?.name}
        </span>
      }
      footer={
        <>
          {schedule && (
            <Button variant="destructive" size="sm" className="mr-auto" onClick={remove} disabled={deleting || saving}>
              <Trash2 size={13} aria-hidden="true" /> {deleting ? "Removing…" : "Remove rotation"}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} disabled={saving || form.userIds.length === 0}>
            {saving ? "Saving…" : schedule ? "Save changes" : "Create rotation"}
          </Button>
        </>
      }
    >
      {!loaded ? (
        <div className="h-40 animate-pulse rounded-lg bg-bg-subtle" />
      ) : (
        <div className="space-y-5">
          <p>
            Rotates through the people below in order, each holding the shift for a fixed number of hours. An escalation tier set to "whoever's on call"
            resolves to whichever person's shift is active at the moment that tier fires.
          </p>

          <div>
            <label className="mb-1.5 block text-sm text-text-secondary">Rotation order</label>
            {form.userIds.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-text-secondary">No one in the rotation yet — add someone below.</p>
            ) : (
              <div className="space-y-1.5">
                {form.userIds.map((uid, i) => (
                  <div key={`${uid}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle/40 px-3 py-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{userLabel(users, uid)}</span>
                    <span className="shrink-0 font-mono text-2xs text-text-secondary">#{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => moveInRotation(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="cursor-pointer rounded p-1 text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronUp size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveInRotation(i, 1)}
                      disabled={i === form.userIds.length - 1}
                      aria-label="Move down"
                      className="cursor-pointer rounded p-1 text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronDown size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromRotation(i)}
                      aria-label={`Remove ${userLabel(users, uid)} from rotation`}
                      className="cursor-pointer rounded p-1 text-text-secondary transition-colors duration-150 hover:bg-critical-subtle hover:text-critical"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="flex-1">
                <option value="">Add a person to the rotation…</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" size="sm" onClick={addToRotation} disabled={!addUserId}>
                Add
              </Button>
            </div>
            {users !== null && availableUsers.length === 0 && form.userIds.length === 0 && (
              <p className="mt-1 text-xs text-text-secondary">No users available — invite teammates under Admin → Users first.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="Shift length (hours)" hint="How long each person holds the shift before it hands off to the next in order.">
              {(ids) => (
                <Input
                  {...ids}
                  type="number"
                  min={1}
                  max={720}
                  className="w-full"
                  value={form.shiftLengthHours}
                  onChange={(e) => setForm((f) => ({ ...f, shiftLengthHours: Number(e.target.value) }))}
                />
              )}
            </FieldGroup>
            <FieldGroup label="Rotation starts" hint="When the first person's shift began (or begins) — every later shift is calculated from this point.">
              {(ids) => (
                <Input
                  {...ids}
                  type="datetime-local"
                  className="w-full"
                  value={form.rotationStartAtLocal}
                  onChange={(e) => setForm((f) => ({ ...f, rotationStartAtLocal: e.target.value }))}
                />
              )}
            </FieldGroup>
          </div>

          <div className="border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-text-primary">Schedule preview</h3>
                {currentSegment ? (
                  <p className="text-xs text-text-secondary">
                    On call right now: <span className="font-medium text-text-primary">{userLabel(users, form.userIds[currentSegment.userIndex]!)}</span>
                  </p>
                ) : (
                  <p className="text-xs text-text-secondary">No one is on call right now.</p>
                )}
              </div>
              <Select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} className="py-1.5 text-xs">
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            {!previewSchedule || segments.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-text-secondary">
                {form.userIds.length === 0 ? "Add people to the rotation to see a schedule preview." : "Nothing scheduled in this window yet."}
              </p>
            ) : (
              <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
                {days.map((day) => {
                  const dayStart = day.getTime();
                  const dayEnd = dayStart + 86_400_000;
                  const daySegments = segments.filter((s) => s.start.getTime() < dayEnd && s.end.getTime() > dayStart);
                  return (
                    <div key={dayStart} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-2xs text-text-secondary">
                        {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                      <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-bg-subtle/60">
                        {daySegments.length === 0 && dayStart >= new Date(previewSchedule.rotationStartAt).getTime() && (
                          <div className="absolute inset-0" />
                        )}
                        {daySegments.map((s, i) => {
                          const left = Math.max(0, ((s.start.getTime() - dayStart) / 86_400_000) * 100);
                          const right = Math.min(100, ((s.end.getTime() - dayStart) / 86_400_000) * 100);
                          const width = Math.max(0, right - left);
                          const color = CATEGORICAL_PALETTE[s.userIndex % CATEGORICAL_PALETTE.length];
                          return (
                            <div
                              key={i}
                              title={`${userLabel(users, form.userIds[s.userIndex]!)}: ${s.start.toLocaleString()} – ${s.end.toLocaleString()}`}
                              className="absolute inset-y-0 flex items-center overflow-hidden px-1.5 text-2xs font-medium text-background"
                              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }}
                            >
                              <span className="truncate">{userLabel(users, form.userIds[s.userIndex]!).split("@")[0]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {form.userIds.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {form.userIds.map((uid, i) => (
                  <span key={`${uid}-legend-${i}`} className="flex items-center gap-1.5 text-2xs text-text-secondary">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }} aria-hidden="true" />
                    {userLabel(users, uid)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

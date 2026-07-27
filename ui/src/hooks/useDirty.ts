import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Tracks whether a settings object has changed since it was last loaded or saved, so a page can
 * show its Save button only when there's actually something to save (steps/04-component-spec.md
 * "save button appears only on change") instead of a button that's always there whether or not it
 * does anything. The baseline is captured once, on the first non-null value seen, and again
 * whenever the caller confirms a save succeeded via `markClean()` — otherwise the button would stay
 * visible forever after the first edit, even once that edit's been saved.
 */
export function useDirty<T>(current: T | null): [boolean, () => void] {
  const baseline = useRef<string | null>(null);
  const [, forceRerender] = useState(0);
  if (baseline.current === null && current != null) baseline.current = JSON.stringify(current);

  const markClean = useCallback(() => {
    if (current != null) baseline.current = JSON.stringify(current);
    forceRerender((n) => n + 1);
  }, [current]);

  const dirty = useMemo(() => {
    if (current == null || baseline.current == null) return false;
    return JSON.stringify(current) !== baseline.current;
  }, [current]);

  return [dirty, markClean];
}

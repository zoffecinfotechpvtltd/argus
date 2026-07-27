import { useCallback, useRef, useState } from "react";

/**
 * Measures an element's size via ResizeObserver, using a callback ref rather than a plain
 * ref + mount-only effect. A plain ref only re-attaches the observer on the hook's own mount,
 * which misses elements that render conditionally after the first paint (e.g. behind a
 * `data.length === 0 ? empty-state : <div ref={...}>` branch) — the observer would set up
 * against `null` and never retry, leaving size stuck at {0, 0} forever. A callback ref re-fires
 * every time the underlying DOM node actually changes, so it also catches that case.
 */
export function useContainerSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;

    setSize({ width: el.clientWidth, height: el.clientHeight });
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return { ref, size };
}

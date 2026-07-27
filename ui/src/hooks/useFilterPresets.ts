import { useEffect, useState } from "react";

export interface FilterPreset<T> {
  name: string;
  filters: T;
}

/** Named, localStorage-persisted filter combinations — per page, per browser, not synced across
 * devices, consistent with this app's existing client-only-preference pattern (e.g. the sidebar's
 * collapse state). Re-entering the same filter combination on every visit is the actual annoyance
 * this solves; nothing here is shared with other users or other machines. */
export function useFilterPresets<T>(storageKey: string) {
  const [presets, setPresets] = useState<FilterPreset<T>[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as FilterPreset<T>[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(presets));
  }, [presets, storageKey]);

  function save(name: string, filters: T) {
    setPresets((prev) => [...prev.filter((p) => p.name !== name), { name, filters }]);
  }

  function remove(name: string) {
    setPresets((prev) => prev.filter((p) => p.name !== name));
  }

  return { presets, save, remove };
}

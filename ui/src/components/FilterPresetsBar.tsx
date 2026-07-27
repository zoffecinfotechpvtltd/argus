import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import { Button, Input } from "./ui";
import type { FilterPreset } from "../hooks/useFilterPresets";

export function FilterPresetsBar<T>({
  presets,
  onApply,
  onSave,
  onRemove,
}: {
  presets: FilterPreset<T>[];
  onApply: (filters: T) => void;
  onSave: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function confirmSave() {
    if (!name.trim()) return;
    onSave(name.trim());
    setName("");
    setNaming(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <span key={p.name} className="flex items-center gap-1 rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-xs text-text-secondary">
          <button onClick={() => onApply(p.filters)} className="cursor-pointer hover:text-text-primary">
            {p.name}
          </button>
          <button
            onClick={() => onRemove(p.name)}
            aria-label={`Remove preset ${p.name}`}
            className="cursor-pointer text-text-secondary hover:text-critical"
          >
            <X size={11} aria-hidden="true" />
          </button>
        </span>
      ))}
      {naming ? (
        <span className="flex items-center gap-1">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmSave()}
            placeholder="Preset name"
            className="w-32 py-1 text-xs"
          />
          <Button size="sm" variant="secondary" onClick={confirmSave}>
            Save
          </Button>
        </span>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-foreground-muted/50 hover:text-text-primary"
        >
          <Bookmark size={11} aria-hidden="true" /> Save current filters
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  GlassSize,
  createGlassSize,
  deleteGlassSize,
  fetchGlassSizes,
} from "@/lib/api";
import { NumericField } from "@/components/NumericField";

/** View/add/remove the user's configured water containers — the single
 * implementation shared by the standalone Profile page and the app
 * sidebar's "Glass sizes" section, so there's exactly one glass-size
 * editor rather than two independently-maintained copies. Deleting a size
 * only removes the *container definition* — it never touches or rewrites
 * already-logged water_logs rows, which keep the volume they were logged
 * with regardless of later configuration changes. */
export function GlassSizesManager() {
  const [glassSizes, setGlassSizes] = useState<GlassSize[] | null>(null);
  const [label, setLabel] = useState("");
  const [volume, setVolume] = useState(250);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGlassSizes()
      .then(setGlassSizes)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load glass sizes."));
  }, []);

  async function handleAdd() {
    if (!label.trim()) return;
    setError(null);
    try {
      const created = await createGlassSize(label, volume);
      setGlassSizes((prev) => [...(prev ?? []), created]);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that size.");
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteGlassSize(id);
      setGlassSizes((prev) => (prev ?? []).filter((g) => g.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that size.");
    }
  }

  return (
    <div className="space-y-3">
      {glassSizes === null ? (
        <p className="text-xs text-on-surface-variant">Loading…</p>
      ) : glassSizes.length === 0 ? (
        <p className="text-xs text-on-surface-variant">
          No custom containers yet — logging uses a default 250ml/500ml glass until you add one.
        </p>
      ) : (
        <ul className="space-y-1">
          {glassSizes.map((g) => (
            <li key={g.id} className="flex items-center justify-between text-sm">
              <span className="text-on-surface">
                {g.label} ({g.volume_ml}ml)
              </span>
              <button
                type="button"
                onClick={() => handleDelete(g.id)}
                className="text-xs font-medium text-fat"
                aria-label={`Remove ${g.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Big bottle"
            className="input w-28"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
          ml
          <NumericField min={1} max={5000} value={volume} onCommit={setVolume} className="input w-20" />
        </label>
        <button
          type="button"
          onClick={handleAdd}
          className="rounded-[var(--radius-control)] bg-primary px-3 py-2 text-xs font-semibold text-on-primary"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-fat">{error}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { logManualActivity } from "@/lib/api";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ActivityLogger() {
  const [steps, setSteps] = useState<number | "">("");
  const [minutes, setMinutes] = useState<number | "">("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await logManualActivity(
        todayIso(),
        steps === "" ? null : steps,
        minutes === "" ? null : minutes,
      );
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-on-surface">Today&apos;s activity</h2>
      <p className="mb-3 text-xs text-on-surface-variant">
        Automatic Health Connect / HealthKit sync isn&apos;t possible from a web app — both are
        native-OS-only APIs with no browser access. Log manually instead.
      </p>
      <div className="flex items-center gap-2">
        <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
          Steps
          <input
            type="number"
            min={0}
            value={steps}
            onChange={(e) => setSteps(e.target.value === "" ? "" : Number(e.target.value))}
            className="input w-24"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
          Workout (min)
          <input
            type="number"
            min={0}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value === "" ? "" : Number(e.target.value))}
            className="input w-24"
          />
        </label>
        <button
          onClick={handleSave}
          className="ml-auto self-end rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
        >
          Save
        </button>
      </div>
      {saved && <p className="mt-2 text-xs text-primary">Saved.</p>}
      {error && <p className="mt-2 text-xs text-fat">{error}</p>}
    </section>
  );
}

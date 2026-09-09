"use client";

import { useEffect, useState } from "react";
import { fetchActivityLogs, logManualActivity } from "@/lib/api";
import { localDateIso as todayIso } from "@/lib/date";

export function ActivityLogger() {
  const [steps, setSteps] = useState<number | "">("");
  const [minutes, setMinutes] = useState<number | "">("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const today = todayIso();
    // Show whatever the user already recorded for today, not a blank form
    // that looks like nothing was logged — a real bug this fixes.
    fetchActivityLogs(today, today)
      .then((logs) => {
        if (cancelled) return;
        const manual = logs.find((l) => l.source === "manual");
        if (manual) {
          if (manual.steps !== null) setSteps(manual.steps);
          if (manual.workout_minutes !== null) setMinutes(manual.workout_minutes);
          setSaved(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      {loaded && saved && (
        <p className="mb-2 text-xs text-primary">
          Recorded today: {steps === "" ? "0" : steps} steps
          {minutes !== "" ? `, ${minutes} min workout` : ""}.
        </p>
      )}
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
      {error && <p className="mt-2 text-xs text-fat">{error}</p>}
    </section>
  );
}

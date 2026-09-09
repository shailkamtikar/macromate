"use client";

import { useState } from "react";
import { DietaryMode, GenerateDietResponse, generateDiet } from "@/lib/api";

const MODE_LABELS: Record<DietaryMode, string> = {
  vegetarian: "Vegetarian",
  egg_inclusive: "Eggetarian",
  non_vegetarian: "Non-vegetarian",
};

export function DietPlanGenerator() {
  const [mode, setMode] = useState<DietaryMode>("non_vegetarian");
  const [plan, setPlan] = useState<GenerateDietResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      setPlan(await generateDiet(mode));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate a plan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-on-surface">Generate a meal plan</h2>
      <p className="mb-3 text-xs text-on-surface-variant">
        Built to fit your actual daily target — not a generic plan.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as DietaryMode)}
          className="input"
        >
          {(Object.entries(MODE_LABELS) as [DietaryMode, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="ml-auto rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-fat">{error}</p>}

      {plan && (
        <div className="mt-4 space-y-2">
          {!plan.within_tolerance && (
            <p className="rounded-[var(--radius-control)] bg-carbs/10 p-2 text-xs text-carbs">
              This plan&apos;s estimated total ({Math.round(plan.plan_total_calories)} kcal)
              drifted more than expected from your {plan.target.calories} kcal target — treat it
              as a rough starting point.
            </p>
          )}
          {plan.meals.map((meal, i) => (
            <div key={i} className="rounded-[var(--radius-control)] bg-surface-container-low p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  {meal.meal_type}
                </p>
                <p className="text-xs text-on-surface-variant">{Math.round(meal.calories)} kcal</p>
              </div>
              <p className="mt-1 text-sm text-on-surface">{meal.description}</p>
            </div>
          ))}
          <p className="pt-1 text-xs italic text-on-surface-variant">{plan.notes}</p>
        </div>
      )}
    </section>
  );
}

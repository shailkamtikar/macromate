"use client";

import { useState } from "react";
import {
  ApiError,
  CalculateFoodsResponse,
  MealType,
  calculateFoodsWithAi,
  logFood,
} from "@/lib/api";
import { useSession } from "@/lib/useSession";
import { DietPlanGenerator } from "@/components/DietPlanGenerator";

const MEAL_OPTIONS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function inferMealType(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 18) return "snack";
  return "dinner";
}

export default function CalculatePage() {
  const { session, loading: sessionLoading } = useSession();
  const [text, setText] = useState("");
  const [result, setResult] = useState<CalculateFoodsResponse | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [mealType, setMealType] = useState<MealType>(inferMealType());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggedIndexes, setLoggedIndexes] = useState<Set<number>>(new Set());

  if (sessionLoading) return <p className="p-10 text-sm text-on-surface-variant">Loading…</p>;
  if (!session) {
    return (
      <p className="p-10 text-sm text-on-surface-variant">
        <a href="/login" className="font-semibold text-primary">
          Log in
        </a>{" "}
        first.
      </p>
    );
  }

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    setLoggedIndexes(new Set());
    try {
      const res = await calculateFoodsWithAi(text);
      setResult(res);
      const initialQuantities: Record<number, number> = {};
      res.items.forEach((item, i) => {
        initialQuantities[i] = item.quantity_multiplier;
      });
      setQuantities(initialQuantities);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Couldn't calculate that: ${err.message}`
          : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogItem(index: number) {
    if (!result) return;
    const item = result.items[index];
    if (!item.food_item_id) return;
    try {
      await logFood(item.food_item_id, mealType, quantities[index] ?? item.quantity_multiplier);
      setLoggedIndexes((prev) => new Set(prev).add(index));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log that item.");
    }
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl space-y-4">
        <header>
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            Calculate with AI
          </h1>
          <p className="text-sm text-on-surface-variant">
            Describe what you ate in plain language — e.g. &quot;200g paneer, 1 roti, 1
            cup rice&quot;.
          </p>
        </header>

        <form
          onSubmit={handleCalculate}
          className="space-y-3 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What did you eat?"
            rows={3}
            className="input w-full resize-none"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-on-surface-variant">Log as:</label>
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType)}
              className="input"
            >
              {MEAL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={loading || text.trim().length === 0}
              className="ml-auto rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
            >
              {loading ? "Calculating…" : "Calculate"}
            </button>
          </div>
        </form>

        {error && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {error}
          </p>
        )}

        {result && (
          <section className="space-y-3">
            {result.items.map((item, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm"
              >
                <p className="text-xs text-on-surface-variant">&quot;{item.raw_phrase}&quot;</p>
                {item.resolved ? (
                  <>
                    <div className="mt-1 flex items-center justify-between">
                      <p className="font-medium text-on-surface">{item.food_name}</p>
                      <p className="text-sm font-semibold text-on-surface">
                        {Math.round((item.calories ?? 0) * ((quantities[i] ?? 1) / item.quantity_multiplier))}{" "}
                        kcal
                      </p>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-on-surface-variant">Quantity (x servings):</label>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={quantities[i] ?? item.quantity_multiplier}
                        onChange={(e) =>
                          setQuantities((prev) => ({ ...prev, [i]: Number(e.target.value) }))
                        }
                        className="input w-20"
                      />
                      <button
                        onClick={() => handleLogItem(i)}
                        disabled={loggedIndexes.has(i)}
                        className="ml-auto rounded-[var(--radius-control)] bg-primary-container px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-50"
                      >
                        {loggedIndexes.has(i) ? "Logged ✓" : "Add to log"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Couldn&apos;t confidently match this to a food in the database. Try{" "}
                    <a href="/today" className="font-semibold text-primary">
                      searching manually
                    </a>{" "}
                    or adding it as a custom food.
                  </p>
                )}
              </div>
            ))}

            <div className="rounded-[var(--radius-card)] bg-surface-container-low p-4">
              <p className="text-sm font-semibold text-on-surface">
                Total: {Math.round(result.total.calories)} kcal · P{" "}
                {Math.round(result.total.protein_g)}g · C {Math.round(result.total.carbs_g)}g · F{" "}
                {Math.round(result.total.fat_g)}g
              </p>
            </div>
          </section>
        )}

        <DietPlanGenerator />
      </div>
    </main>
  );
}

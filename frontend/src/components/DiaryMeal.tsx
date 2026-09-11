"use client";

import { useState } from "react";
import { FoodLog, MealType } from "@/lib/api";
import { FoodEntryFields } from "@/components/FoodEntryFields";
import {
  MEAL_LABELS,
  ServingUnit,
  amountToQuantity,
  describeAmount,
  quantityToAmount,
  servingWeight,
} from "@/lib/servings";

interface DiaryMealProps {
  meal: MealType;
  entries: FoodLog[];
  busyLogId: string | null;
  onSave: (
    logId: string,
    changes: { quantity?: number; meal_type?: MealType },
  ) => void | Promise<void>;
  onDelete: (log: FoodLog) => void | Promise<void>;
  onAddFood: (meal: MealType) => void;
}

function totalsFor(entries: FoodLog[]) {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein_g: acc.protein_g + e.protein_g,
      carbs_g: acc.carbs_g + e.carbs_g,
      fat_g: acc.fat_g + e.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

export function DiaryMeal({
  meal,
  entries,
  busyLogId,
  onSave,
  onDelete,
  onAddFood,
}: DiaryMealProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<ServingUnit>("serving");
  const [editMeal, setEditMeal] = useState<MealType>(meal);

  const totals = totalsFor(entries);

  function startEdit(log: FoodLog) {
    const weight = servingWeight(log);
    const nextUnit: ServingUnit = weight !== null ? "weight" : "serving";
    setEditingId(log.id);
    setUnit(nextUnit);
    setAmount(quantityToAmount(log.quantity, nextUnit, log));
    setEditMeal(log.meal_type);
  }

  async function saveEdit(log: FoodLog) {
    const quantity = amountToQuantity(amount, unit, log);
    if (!(quantity > 0)) return;
    await onSave(log.id, { quantity, meal_type: editMeal });
    setEditingId(null);
  }

  return (
    <section
      data-testid={`meal-${meal}`}
      className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-on-surface">{MEAL_LABELS[meal]}</h3>
        <span
          data-testid={`meal-total-${meal}`}
          className="text-xs font-semibold text-on-surface-variant"
        >
          {Math.round(totals.calories)} kcal
        </span>
      </div>

      {entries.length > 0 && (
        <p className="mt-0.5 text-xs text-on-surface-variant">
          P {Math.round(totals.protein_g)}g · C {Math.round(totals.carbs_g)}g · F{" "}
          {Math.round(totals.fat_g)}g
        </p>
      )}

      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-on-surface-variant">
          Nothing logged for {MEAL_LABELS[meal].toLowerCase()} yet.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-outline-variant/60">
          {entries.map((log) =>
            editingId === log.id ? (
              <li key={log.id} className="space-y-2 py-2">
                <p className="text-sm font-medium text-on-surface">{log.food_name}</p>
                <FoodEntryFields
                  idPrefix={`edit-${log.id}`}
                  basis={log}
                  amount={amount}
                  unit={unit}
                  meal={editMeal}
                  onAmountChange={setAmount}
                  onUnitChange={(next) => {
                    const weight = servingWeight(log);
                    if (weight === null) return;
                    setUnit(next);
                    setAmount(
                      next === "weight"
                        ? Math.round(amount * weight * 100) / 100
                        : Math.round((amount / weight) * 100) / 100,
                    );
                  }}
                  onMealChange={setEditMeal}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyLogId === log.id}
                    onClick={() => saveEdit(log)}
                    aria-label={`Save ${log.food_name}`}
                    className="rounded-[var(--radius-control)] bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    aria-label="Cancel edit"
                    className="rounded-[var(--radius-control)] border border-outline-variant px-3 py-1.5 text-xs font-semibold text-on-surface-variant"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busyLogId === log.id}
                    onClick={() => onDelete(log)}
                    aria-label={`Remove ${log.food_name}`}
                    className="ml-auto rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold text-fat disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ) : (
              <li key={log.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-on-surface">
                    {log.food_name}
                    {log.source === "ai_estimate" && (
                      <span className="ml-1 text-xs font-normal text-on-surface-variant">
                        · AI estimate
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-on-surface-variant">
                    {describeAmount(log.quantity, log)} · P {Math.round(log.protein_g)}g · C{" "}
                    {Math.round(log.carbs_g)}g · F {Math.round(log.fat_g)}g
                  </p>
                </div>
                <span className="flex-shrink-0 text-sm text-on-surface-variant">
                  {Math.round(log.calories)} kcal
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(log)}
                  aria-label={`Edit ${log.food_name}`}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">edit</span>
                </button>
                <button
                  type="button"
                  disabled={busyLogId === log.id}
                  onClick={() => onDelete(log)}
                  aria-label={`Remove ${log.food_name}`}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-fat hover:bg-fat/10 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">delete</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onAddFood(meal)}
          className="flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">add</span>
          Add food to {MEAL_LABELS[meal].toLowerCase()}
        </button>
        <a
          href={`/calculate?meal=${meal}`}
          className="flex items-center gap-1 text-xs font-semibold text-on-surface-variant underline-offset-2 hover:underline"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">auto_awesome</span>
          Calculate with AI
        </a>
      </div>
    </section>
  );
}

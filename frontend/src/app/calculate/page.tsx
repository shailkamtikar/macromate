"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AiEstimateInput,
  ApiError,
  CalculateFoodsResponse,
  FoodCandidate,
  FoodItem,
  MealType,
  NutritionSource,
  ParsedFoodItem,
  ParsedUnit,
  ServingBasis,
  calculateFoodsWithAi,
  logAiEstimateFood,
  logFood,
} from "@/lib/api";
import { useSession } from "@/lib/useSession";
import { FoodPicker } from "@/components/FoodPicker";
import { DietPlanGenerator } from "@/components/DietPlanGenerator";
import {
  MEAL_LABELS,
  MEAL_TYPES,
  ServingUnit,
  amountToQuantity,
  inferMealType,
  servingWeight,
  unitOptions,
  weightUnitLabel,
} from "@/lib/servings";

type RowStatus = "resolved" | "ambiguous" | "unresolved" | "logged";

interface PerServing {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface ReviewRow {
  key: number;
  raw_phrase: string;
  status: RowStatus;
  removed: boolean;
  parsedAmount: number;
  parsedUnit: ParsedUnit;
  source: NutritionSource;
  food_item_id: string | null;
  food_name: string | null;
  basis: ServingBasis;
  perServing: PerServing | null;
  entryAmount: number;
  entryUnit: ServingUnit;
  quantityIsAssumption: boolean;
  // Gemini's own caveat about its estimate (ai_estimate rows only), e.g.
  // "Values vary by brand and fat content."
  assumption: string | null;
  candidates: FoodCandidate[] | null;
  // A ready-to-use estimate fallback for an ambiguous row, so ambiguity
  // never has to block the user from proceeding.
  estimateFallback: FoodCandidate | null;
  showSearch: boolean;
}

/** Mirrors the backend's deterministic amount+unit -> quantity resolution
 * (app/routers/ai_food._resolve_quantity) so editing/re-resolving an item
 * client-side stays consistent with what the server would have computed —
 * this never invents a new nutrition number, it only decides which of the
 * *food's own real* per-serving numbers to scale and by how much. */
function initialEntry(
  amount: number,
  unit: ParsedUnit,
  basis: ServingBasis,
): { entryAmount: number; entryUnit: ServingUnit; isAssumption: boolean } {
  if (unit === "serving") return { entryAmount: amount, entryUnit: "serving", isAssumption: false };
  const weight = servingWeight(basis);
  if (weight !== null && basis.serving_weight_unit === unit) {
    return { entryAmount: amount, entryUnit: "weight", isAssumption: false };
  }
  return { entryAmount: 1, entryUnit: "serving", isAssumption: true };
}

function rowFromParsedItem(item: ParsedFoodItem, key: number): ReviewRow {
  const shared = {
    key,
    raw_phrase: item.raw_phrase,
    removed: false,
    parsedAmount: item.amount,
    parsedUnit: item.unit,
    showSearch: false,
    estimateFallback: null,
  };

  if (item.resolved && item.source === "database" && item.food_item_id && item.quantity && item.calories !== null) {
    const basis: ServingBasis = {
      serving_description: item.serving_description,
      serving_weight: item.serving_weight,
      serving_weight_unit: item.serving_weight_unit,
    };
    const perServing: PerServing = {
      calories: item.calories / item.quantity,
      protein_g: (item.protein_g ?? 0) / item.quantity,
      carbs_g: (item.carbs_g ?? 0) / item.quantity,
      fat_g: (item.fat_g ?? 0) / item.quantity,
    };
    const entry = initialEntry(item.amount, item.unit, basis);
    return {
      ...shared,
      status: "resolved",
      source: "database",
      food_item_id: item.food_item_id,
      food_name: item.food_name,
      basis,
      perServing,
      entryAmount: item.quantity_is_assumption ? entry.entryAmount : item.quantity,
      entryUnit: entry.entryUnit,
      quantityIsAssumption: item.quantity_is_assumption,
      assumption: null,
      candidates: null,
    };
  }

  if (item.resolved && item.source === "ai_estimate" && item.quantity && item.calories !== null) {
    // Gemini already estimated for the exact stated amount -- no further
    // unit conversion is meaningful, so `basis` carries no serving weight
    // and the amount is edited directly (proportional scaling only).
    const perServing: PerServing = {
      calories: item.calories / item.quantity,
      protein_g: (item.protein_g ?? 0) / item.quantity,
      carbs_g: (item.carbs_g ?? 0) / item.quantity,
      fat_g: (item.fat_g ?? 0) / item.quantity,
    };
    return {
      ...shared,
      status: "resolved",
      source: "ai_estimate",
      food_item_id: null,
      food_name: item.food_name,
      basis: {},
      perServing,
      entryAmount: item.quantity,
      entryUnit: "serving",
      quantityIsAssumption: false,
      assumption: item.assumption,
      candidates: null,
    };
  }

  if (item.ambiguous && item.candidates) {
    return {
      ...shared,
      status: "ambiguous",
      source: null,
      food_item_id: null,
      food_name: null,
      basis: {},
      perServing: null,
      entryAmount: item.amount,
      entryUnit: "serving",
      quantityIsAssumption: false,
      assumption: null,
      candidates: item.candidates,
      estimateFallback: item.estimate,
    };
  }

  return {
    ...shared,
    status: "unresolved",
    source: null,
    food_item_id: null,
    food_name: null,
    basis: {},
    perServing: null,
    entryAmount: item.amount,
    entryUnit: "serving",
    quantityIsAssumption: false,
    assumption: null,
    candidates: null,
  };
}

function rowNutrition(row: ReviewRow) {
  if (row.status !== "resolved" || !row.perServing) return null;
  const quantity = amountToQuantity(row.entryAmount, row.entryUnit, row.basis);
  return {
    quantity,
    calories: row.perServing.calories * quantity,
    protein_g: row.perServing.protein_g * quantity,
    carbs_g: row.perServing.carbs_g * quantity,
    fat_g: row.perServing.fat_g * quantity,
  };
}

export default function CalculatePage() {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-on-surface-variant">Loading…</p>}>
      <CalculatePageInner />
    </Suspense>
  );
}

function CalculatePageInner() {
  const { session, loading: sessionLoading } = useSession();
  const searchParams = useSearchParams();
  const initialMeal = (searchParams.get("meal") as MealType | null) ?? inferMealType();

  const [text, setText] = useState("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [hasResult, setHasResult] = useState(false);
  const [mealType, setMealType] = useState<MealType>(
    MEAL_TYPES.includes(initialMeal) ? initialMeal : inferMealType(),
  );
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

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
    setSuccessCount(null);
    setParsing(true);
    setRows([]);
    setHasResult(false);
    try {
      const res: CalculateFoodsResponse = await calculateFoodsWithAi(text);
      setRows(res.items.map((item, i) => rowFromParsedItem(item, i)));
      setHasResult(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Couldn't work out what you ate: ${err.message}`
          : "Something went wrong.",
      );
    } finally {
      setParsing(false);
    }
  }

  function updateRow(key: number, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Resolves a row against a concrete food's real nutrition/serving
   * metadata, reusing the row's own originally-parsed amount+unit (never
   * whatever transient amount a picker/candidate UI happened to have) —
   * the same deterministic conversion used for every other row, so a
   * manually-chosen replacement is indistinguishable from an
   * automatically-resolved or disambiguated one. This never persists
   * anything; it only updates local review state. */
  function resolveRowWith(
    key: number,
    source: NutritionSource,
    food: { id: string | null; name: string },
    basis: ServingBasis,
    perServing: PerServing,
    assumption: string | null = null,
  ) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const entry = initialEntry(r.parsedAmount, r.parsedUnit, basis);
        return {
          ...r,
          status: "resolved",
          source,
          food_item_id: food.id,
          food_name: food.name,
          basis,
          perServing,
          entryAmount: entry.entryAmount,
          entryUnit: entry.entryUnit,
          quantityIsAssumption: entry.isAssumption,
          assumption,
          candidates: null,
          estimateFallback: null,
          showSearch: false,
        };
      }),
    );
  }

  function pickCandidate(row: ReviewRow, candidate: FoodCandidate) {
    resolveRowWith(
      row.key,
      "database",
      { id: candidate.food_item_id, name: candidate.food_name },
      {
        serving_description: candidate.serving_description,
        serving_weight: candidate.serving_weight,
        serving_weight_unit: candidate.serving_weight_unit,
      },
      {
        calories: candidate.calories,
        protein_g: candidate.protein_g,
        carbs_g: candidate.carbs_g,
        fat_g: candidate.fat_g,
      },
    );
  }

  /** The ambiguity-fallback estimate offered alongside real database
   * candidates -- picking it behaves exactly like an unresolved item
   * falling back to an estimate, just without waiting for "no match". */
  function pickEstimateFallback(row: ReviewRow) {
    const estimate = row.estimateFallback;
    if (!estimate) return;
    resolveRowWith(
      row.key,
      "ai_estimate",
      { id: null, name: estimate.food_name },
      {},
      {
        calories: estimate.calories,
        protein_g: estimate.protein_g,
        carbs_g: estimate.carbs_g,
        fat_g: estimate.fat_g,
      },
      null,
    );
  }

  /** An unresolved item's manually-found replacement (searched or newly
   * created via the embedded FoodPicker) — joins the review exactly like
   * any other resolved row, still fully unconfirmed/unpersisted. */
  function resolveWithFoodItem(key: number, food: FoodItem) {
    resolveRowWith(
      key,
      "database",
      food,
      {
        serving_description: food.serving_description,
        serving_weight: food.serving_weight,
        serving_weight_unit: food.serving_weight_unit,
      },
      {
        calories: food.calories,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fat_g: food.fat_g,
      },
    );
  }

  const activeRows = rows.filter((r) => !r.removed);
  const confirmable = activeRows.filter((r) => r.status === "resolved");
  const total = confirmable.reduce(
    (acc, row) => {
      const n = rowNutrition(row);
      if (!n) return acc;
      return {
        calories: acc.calories + n.calories,
        protein_g: acc.protein_g + n.protein_g,
        carbs_g: acc.carbs_g + n.carbs_g,
        fat_g: acc.fat_g + n.fat_g,
      };
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );

  async function handleConfirm() {
    if (confirming || confirmable.length === 0) return;
    setConfirming(true);
    setError(null);
    setSuccessCount(null);
    const succeeded: number[] = [];
    try {
      for (const row of confirmable) {
        const n = rowNutrition(row);
        if (!n || !(n.quantity > 0) || !row.perServing) continue;
        if (row.source === "database") {
          if (!row.food_item_id) continue;
          await logFood(row.food_item_id, mealType, n.quantity);
        } else {
          // ai_estimate: `perServing` is the estimate's own per-1-unit
          // basis (see rowFromParsedItem) -- the exact same shape/meaning
          // logAiEstimateFood expects, so no re-derivation needed.
          const unitLabel = row.parsedUnit === "g" ? "g" : row.parsedUnit === "ml" ? "ml" : "serving";
          const estimate: AiEstimateInput = {
            name: row.food_name ?? row.raw_phrase,
            serving_description: `1 ${unitLabel}`,
            calories: row.perServing.calories,
            protein_g: row.perServing.protein_g,
            carbs_g: row.perServing.carbs_g,
            fat_g: row.perServing.fat_g,
          };
          await logAiEstimateFood(estimate, mealType, n.quantity);
        }
        succeeded.push(row.key);
      }
      setRows((prev) =>
        prev.map((r) => (succeeded.includes(r.key) ? { ...r, status: "logged" as const } : r)),
      );
      setSuccessCount(succeeded.length);
    } catch (err) {
      // Mark whatever already succeeded before the failure as logged, so a
      // retry can't double-log those items — only the remainder is retried.
      setRows((prev) =>
        prev.map((r) => (succeeded.includes(r.key) ? { ...r, status: "logged" as const } : r)),
      );
      setError(
        succeeded.length > 0
          ? `Added ${succeeded.length} of ${confirmable.length} foods, then hit an error: ${
              err instanceof Error ? err.message : "unknown error"
            }. The rest are still below — try confirming again.`
          : err instanceof Error
            ? `Couldn't save: ${err.message}`
            : "Couldn't save those foods.",
      );
    } finally {
      setConfirming(false);
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
            Describe what you ate — or ask a nutrition question, e.g. &quot;How many
            calories are in 200g paneer?&quot;. We use the real food database when we
            can; otherwise you get a clearly-labeled AI estimate, never presented as
            verified.
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-on-surface-variant">Log as:</label>
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType)}
              className="input"
            >
              {MEAL_TYPES.map((m) => (
                <option key={m} value={m}>
                  {MEAL_LABELS[m]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={parsing || text.trim().length === 0}
              className="ml-auto rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
            >
              {parsing ? "Working out what you ate…" : "Calculate"}
            </button>
          </div>
        </form>

        {error && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {error}
          </p>
        )}

        {successCount !== null && successCount > 0 && (
          <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-primary/30 bg-primary-container/20 p-3 text-sm">
            <span className="font-medium text-on-surface">
              Added {successCount} food{successCount === 1 ? "" : "s"} to {MEAL_LABELS[mealType]}.
            </span>
            <a href="/today" className="font-semibold text-primary">
              View in Today
            </a>
          </div>
        )}

        {hasResult && rows.length === 0 && (
          <p className="rounded-[var(--radius-card)] border border-dashed border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
            Couldn&apos;t recognize any food in that description. Try describing it
            differently, or search for it directly below.
          </p>
        )}

        {activeRows.length > 0 && (
          <section aria-label="Review your foods" className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Review your foods
            </p>
            {activeRows.map((row) => (
              <ReviewRowCard
                key={row.key}
                row={row}
                meal={mealType}
                onMealChange={setMealType}
                onRemove={() => updateRow(row.key, { removed: true })}
                onEntryChange={(entryAmount, entryUnit) =>
                  updateRow(row.key, { entryAmount, entryUnit })
                }
                onPickCandidate={(candidate) => pickCandidate(row, candidate)}
                onPickEstimateFallback={() => pickEstimateFallback(row)}
                onToggleSearch={() => updateRow(row.key, { showSearch: !row.showSearch })}
                onResolveWithFoodItem={(food) => resolveWithFoodItem(row.key, food)}
              />
            ))}

            {confirmable.length > 0 && (
              <div className="rounded-[var(--radius-card)] bg-surface-container-low p-4">
                <p className="text-sm font-semibold text-on-surface">
                  Total: {Math.round(total.calories)} kcal · P {Math.round(total.protein_g)}g · C{" "}
                  {Math.round(total.carbs_g)}g · F {Math.round(total.fat_g)}g
                </p>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={confirming || confirmable.length === 0}
                  className="mt-3 w-full rounded-[var(--radius-control)] bg-primary py-2.5 text-sm font-semibold text-on-primary disabled:opacity-60"
                >
                  {confirming
                    ? "Adding…"
                    : `Add ${confirmable.length} food${confirmable.length === 1 ? "" : "s"} to ${MEAL_LABELS[mealType]}`}
                </button>
              </div>
            )}
          </section>
        )}

        <DietPlanGenerator />
      </div>
    </main>
  );
}

function ReviewRowCard({
  row,
  meal,
  onMealChange,
  onRemove,
  onEntryChange,
  onPickCandidate,
  onPickEstimateFallback,
  onToggleSearch,
  onResolveWithFoodItem,
}: {
  row: ReviewRow;
  meal: MealType;
  onMealChange: (meal: MealType) => void;
  onRemove: () => void;
  onEntryChange: (amount: number, unit: ServingUnit) => void;
  onPickCandidate: (candidate: FoodCandidate) => void;
  onPickEstimateFallback: () => void;
  onToggleSearch: () => void;
  onResolveWithFoodItem: (food: FoodItem) => void;
}) {
  const nutrition = rowNutrition(row);
  const units = row.status === "resolved" ? unitOptions(row.basis) : [];
  const parsedUnitLabel = row.parsedUnit === "g" ? "g" : row.parsedUnit === "ml" ? "ml" : "serving(s)";

  return (
    <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-on-surface-variant">&quot;{row.raw_phrase}&quot;</p>
        {row.status !== "logged" && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove "${row.raw_phrase}" from review`}
            className="flex-shrink-0 text-on-surface-variant hover:text-fat"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">close</span>
          </button>
        )}
      </div>

      {row.status === "resolved" && nutrition && (
        <>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-medium text-on-surface">
              {row.food_name}
              {row.source === "ai_estimate" && (
                <span className="ml-1.5 text-xs font-normal text-on-surface-variant">
                  · Estimated
                </span>
              )}
            </p>
            <p className="flex-shrink-0 text-sm font-semibold text-on-surface">
              {Math.round(nutrition.calories)} kcal
            </p>
          </div>
          {row.source === "ai_estimate" && (
            <p className="mt-1 text-xs text-on-surface-variant">
              {row.assumption || "Estimated by AI — values vary by brand/preparation, not verified database nutrition."}
            </p>
          )}
          {row.quantityIsAssumption && (
            <p className="mt-1 text-xs text-fat">
              We couldn&apos;t convert &quot;{row.parsedAmount} {row.parsedUnit}&quot; to a real
              amount for this food, so this defaults to 1 serving — adjust it below if that&apos;s
              not right.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Amount {row.source === "ai_estimate" && `(${parsedUnitLabel})`}
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={row.entryAmount}
                aria-label={`Amount for ${row.food_name}`}
                onChange={(e) => onEntryChange(Number(e.target.value), row.entryUnit)}
                className="input w-24"
              />
            </label>
            {units.length > 1 && (
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
                Unit
                <select
                  value={row.entryUnit}
                  aria-label={`Unit for ${row.food_name}`}
                  onChange={(e) => {
                    const nextUnit = e.target.value as ServingUnit;
                    const weight = servingWeight(row.basis);
                    if (weight === null) return;
                    const nextAmount =
                      nextUnit === "weight"
                        ? Math.round(row.entryAmount * weight * 100) / 100
                        : Math.round((row.entryAmount / weight) * 100) / 100;
                    onEntryChange(nextAmount, nextUnit);
                  }}
                  className="input w-24"
                >
                  {units.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === "weight" ? weightUnitLabel(row.basis) : opt.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-on-surface-variant">
              P {Math.round(nutrition.protein_g)}g · C {Math.round(nutrition.carbs_g)}g · F{" "}
              {Math.round(nutrition.fat_g)}g
            </p>
          </div>
          {row.source === "ai_estimate" && (
            <div className="mt-2">
              {!row.showSearch ? (
                <button
                  type="button"
                  onClick={onToggleSearch}
                  className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                >
                  Use a real database food instead
                </button>
              ) : (
                <FoodPicker
                  meal={meal}
                  onMealChange={onMealChange}
                  onSelect={onResolveWithFoodItem}
                  initialQuery={row.food_name ?? row.raw_phrase}
                />
              )}
            </div>
          )}
        </>
      )}

      {row.status === "logged" && (
        <p className="mt-1 text-sm font-medium text-primary">{row.food_name ?? row.raw_phrase} — Logged ✓</p>
      )}

      {row.status === "ambiguous" && row.candidates && (
        <div className="mt-2 space-y-1.5">
          <p className="text-sm text-on-surface">Which did you mean?</p>
          {row.candidates.map((c) => (
            <button
              key={c.food_item_id}
              type="button"
              onClick={() => onPickCandidate(c)}
              className="flex w-full items-center justify-between rounded-[var(--radius-control)] bg-surface-container-low px-3 py-2 text-left hover:bg-surface-container"
            >
              <span className="min-w-0 truncate text-sm text-on-surface">
                {c.food_name} <span className="text-on-surface-variant">· {c.serving_description}</span>
              </span>
              <span className="flex-shrink-0 text-xs text-on-surface-variant">
                {Math.round(c.calories)} kcal
              </span>
            </button>
          ))}
          {row.estimateFallback && (
            <button
              type="button"
              onClick={onPickEstimateFallback}
              className="w-full rounded-[var(--radius-control)] border border-dashed border-outline-variant px-3 py-2 text-left text-xs text-on-surface-variant hover:bg-surface-container"
            >
              None of these — use an AI estimate instead (~
              {Math.round(row.estimateFallback.calories)} kcal)
            </button>
          )}
        </div>
      )}

      {row.status === "unresolved" && (
        <div className="mt-1 space-y-2">
          <p className="text-sm text-on-surface-variant">
            Couldn&apos;t confidently match this to a food in the database.
          </p>
          {!row.showSearch ? (
            <button
              type="button"
              onClick={onToggleSearch}
              className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
            >
              Search or create this food
            </button>
          ) : (
            <FoodPicker
              meal={meal}
              onMealChange={onMealChange}
              onSelect={onResolveWithFoodItem}
              initialQuery={row.raw_phrase}
            />
          )}
        </div>
      )}
    </div>
  );
}

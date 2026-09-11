"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CreateFoodResponse,
  FoodItem,
  MealType,
  createFood,
  fetchRecentFoods,
  logFood,
  searchFoods,
} from "@/lib/api";
import { FoodEntryFields } from "@/components/FoodEntryFields";
import {
  MEAL_LABELS,
  MEAL_TYPES,
  ServingUnit,
  amountToQuantity,
  servingWeight,
  weightUnitLabel,
} from "@/lib/servings";

type Tab = "search" | "recent" | "frequent";

interface FoodPickerProps {
  /** Meal the picker is currently targeting. Controlled by the page so a
   * meal's own "Add food" button can retarget it. */
  meal: MealType;
  onMealChange: (meal: MealType) => void;
  /** Not called when `onSelect` is provided — see below. */
  onLogged?: (log: import("@/lib/api").FoodLog) => void | Promise<void>;
  /** Refresh signal: bump to reload recent/frequent after the diary changes. */
  refreshKey?: number;
  /** Pre-fills and runs a search on mount — used when a caller already
   * knows roughly what the user is looking for (e.g. resolving an AI
   * Calculator item that couldn't be confidently matched). */
  initialQuery?: string;
  /** When provided, picking or creating a food does NOT persist a food log
   * — it hands the chosen food back to the caller instead, and `onLogged`
   * is never called. Used by the AI Calculator: an unresolved item's
   * replacement must stay part of the calculator's own unconfirmed review
   * state (and use the calculator's own parsed amount/unit), not get
   * logged immediately with whatever amount happens to be in this picker. */
  onSelect?: (food: FoodItem) => void;
}

function scaleNutrition(food: FoodItem, quantity: number) {
  // Same arithmetic the server applies when it writes the log's snapshot —
  // this is only a preview of the food's own real values, never a guess.
  return {
    calories: Math.round(food.calories * quantity),
    protein_g: Math.round(food.protein_g * quantity),
    carbs_g: Math.round(food.carbs_g * quantity),
    fat_g: Math.round(food.fat_g * quantity),
  };
}

export function FoodPicker({
  meal,
  onMealChange,
  onLogged,
  refreshKey = 0,
  initialQuery,
  onSelect,
}: FoodPickerProps) {
  const [tab, setTab] = useState<Tab>(initialQuery ? "search" : "recent");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<FoodItem[]>([]);
  const [frequent, setFrequent] = useState<FoodItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<ServingUnit>("serving");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFood, setNewFood] = useState({
    name: "",
    serving_description: "",
    calories: "",
    protein_g: "",
    carbs_g: "",
    fat_g: "",
  });
  const [duplicates, setDuplicates] = useState<FoodItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<string | null>(null);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecentFoods()
      .then((res) => {
        if (cancelled) return;
        setRecent(res.recent);
        setFrequent(res.frequent);
      })
      .catch(() => {
        // Recent/frequent are a convenience — search still works without
        // them, so a failure here shouldn't block logging.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (initialQuery && initialQuery.trim().length >= 2) {
      handleQueryChange(initialQuery);
    }
    // Run the seeded search exactly once on mount, not on every `query` edit afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    setError(null);
    if (value.trim().length > 0) setTab("search");
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (value.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        setResults(await searchFoods(value));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        setSearching(false);
      }
    }, 250);
  }

  function openDetail(food: FoodItem) {
    setSelected(food);
    // Default to the food's own weight unit when it has one — logging
    // "150 g" is more natural than "1 serving" for weighed foods.
    const weight = servingWeight(food);
    setUnit(weight !== null ? "weight" : "serving");
    setAmount(weight !== null ? weight : 1);
    setError(null);
  }

  async function quickAdd(food: FoodItem) {
    setError(null);
    if (onSelect) {
      onSelect(food);
      setQuery("");
      setResults([]);
      setSelected(null);
      return;
    }
    setBusyId(food.id);
    try {
      const log = await logFood(food.id, meal, 1);
      setQuery("");
      setResults([]);
      setSelected(null);
      await onLogged?.(log);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log that food.");
    } finally {
      setBusyId(null);
    }
  }

  async function addSelected() {
    if (!selected) return;
    if (onSelect) {
      onSelect(selected);
      setSelected(null);
      setQuery("");
      setResults([]);
      return;
    }
    const quantity = amountToQuantity(amount, unit, selected);
    if (!(quantity > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError(null);
    setBusyId(selected.id);
    try {
      const log = await logFood(selected.id, meal, quantity);
      setSelected(null);
      setQuery("");
      setResults([]);
      await onLogged?.(log);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log that food.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitCreateFood(force: boolean) {
    setCreateError(null);
    const calories = Number(newFood.calories);
    const protein_g = Number(newFood.protein_g);
    const carbs_g = Number(newFood.carbs_g);
    const fat_g = Number(newFood.fat_g);
    if (!newFood.name.trim() || !newFood.serving_description.trim()) {
      setCreateError("Name and serving description are required.");
      return;
    }
    if ([calories, protein_g, carbs_g, fat_g].some((n) => Number.isNaN(n) || n < 0)) {
      setCreateError("Calories and macros must be numbers ≥ 0.");
      return;
    }
    setCreating(true);
    try {
      const res: CreateFoodResponse = await createFood({
        name: newFood.name.trim(),
        serving_description: newFood.serving_description.trim(),
        calories,
        protein_g,
        carbs_g,
        fat_g,
        force,
      });
      if (res.created) {
        setDuplicates([]);
        setShowCreateForm(false);
        setCreatedNotice(`"${res.created.name}" created — add it to your diary below.`);
        setNewFood({
          name: "",
          serving_description: "",
          calories: "",
          protein_g: "",
          carbs_g: "",
          fat_g: "",
        });
        // Drop the new food straight into the detail panel so creating and
        // logging is one continuous flow, not "create, then go find it".
        openDetail(res.created);
      } else {
        // Likely-duplicate matches found — surface them so the user can
        // either log an existing shared food instead, or force-create.
        setDuplicates(res.possible_duplicates);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create that food.");
    } finally {
      setCreating(false);
    }
  }

  const visibleFoods = useMemo(() => {
    if (tab === "recent") return recent;
    if (tab === "frequent") return frequent;
    return results;
  }, [tab, recent, frequent, results]);

  const preview = selected
    ? scaleNutrition(selected, amountToQuantity(amount, unit, selected))
    : null;

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "search", label: "Search", count: results.length },
    { value: "recent", label: "Recent", count: recent.length },
    { value: "frequent", label: "Frequent", count: frequent.length },
  ];

  return (
    <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-on-surface">Add food</h2>
        <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          Add to
          <select
            aria-label="Meal to add to"
            value={meal}
            onChange={(e) => onMealChange(e.target.value as MealType)}
            className="input py-1 text-xs"
          >
            {MEAL_TYPES.map((value) => (
              <option key={value} value={value}>
                {MEAL_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <input
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search foods…"
        aria-label="Search foods"
        className="input mt-3 w-full"
      />

      <div className="mt-3 flex gap-1 rounded-full bg-surface-container p-0.5">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              tab === t.value
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {searching && tab === "search" && (
        <p className="mt-2 text-xs text-on-surface-variant">Searching…</p>
      )}

      {visibleFoods.length > 0 ? (
        <ul data-testid="food-search-results" className="mt-2 space-y-1">
          {visibleFoods.map((food) => (
            <li
              key={food.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-container-low px-3 py-2"
            >
              <button
                type="button"
                onClick={() => openDetail(food)}
                className="min-w-0 flex-1 text-left"
                aria-label={`Choose amount for ${food.name}`}
              >
                <p className="truncate text-sm font-medium text-on-surface">{food.name}</p>
                <p className="truncate text-xs text-on-surface-variant">
                  {food.serving_description} · {Math.round(food.calories)} kcal · P{" "}
                  {Math.round(food.protein_g)}g
                  {typeof food.log_count === "number" && food.log_count > 1
                    ? ` · logged ${food.log_count}×`
                    : ""}
                </p>
              </button>
              <button
                type="button"
                onClick={() => quickAdd(food)}
                disabled={busyId === food.id}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary disabled:opacity-60"
                aria-label={`Add ${food.name}`}
              >
                +
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-on-surface-variant">
          {tab === "search"
            ? query.trim().length < 2
              ? "Type at least two characters to search the food database."
              : searching
                ? ""
                : "No matches — try another name, or create a custom food below."
            : tab === "recent"
              ? "Foods you log will show up here for one-tap repeat logging."
              : "Your most-logged foods will appear here once you've built up some history."}
        </p>
      )}

      {selected && (
        <div className="mt-3 space-y-3 rounded-[var(--radius-control)] border border-primary/30 bg-surface-container-low p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-on-surface">{selected.name}</p>
              <p className="text-xs text-on-surface-variant">
                {selected.serving_description} · {Math.round(selected.calories)} kcal per serving
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close food details"
              className="text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">close</span>
            </button>
          </div>

          <FoodEntryFields
            idPrefix="add-food"
            basis={selected}
            amount={amount}
            unit={unit}
            meal={meal}
            onAmountChange={setAmount}
            onUnitChange={(next) => {
              // Keep the amount meaningful when switching units instead of
              // reinterpreting "1 serving" as "1 gram".
              const weight = servingWeight(selected);
              if (weight === null) return;
              setUnit(next);
              setAmount(
                next === "weight"
                  ? Math.round(amount * weight * 100) / 100
                  : Math.round((amount / weight) * 100) / 100,
              );
            }}
            onMealChange={onMealChange}
          />

          {preview && (
            <p className="text-xs text-on-surface-variant" data-testid="add-food-preview">
              <strong className="text-on-surface">{preview.calories} kcal</strong> · P{" "}
              {preview.protein_g}g · C {preview.carbs_g}g · F {preview.fat_g}g
              {servingWeight(selected) !== null && unit === "weight"
                ? ` for ${amount} ${weightUnitLabel(selected)}`
                : ""}
            </p>
          )}

          <button
            type="button"
            onClick={addSelected}
            disabled={busyId === selected.id}
            className="w-full rounded-[var(--radius-control)] bg-primary py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {onSelect
              ? "Use this food"
              : busyId === selected.id
                ? "Adding…"
                : `Add to ${MEAL_LABELS[meal]}`}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-fat">{error}</p>}
      {createdNotice && <p className="mt-2 text-xs text-primary">{createdNotice}</p>}

      {!showCreateForm && (
        <button
          type="button"
          onClick={() => {
            setShowCreateForm(true);
            setCreatedNotice(null);
            setDuplicates([]);
          }}
          className="mt-3 text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          Can&apos;t find it? Create a custom food
        </button>
      )}

      {showCreateForm && (
        <div className="mt-3 space-y-2 rounded-[var(--radius-control)] border border-outline-variant bg-surface-container-low p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-on-surface">New custom food</h3>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
                setDuplicates([]);
              }}
              aria-label="Cancel"
              className="text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">close</span>
            </button>
          </div>
          <p className="text-xs text-on-surface-variant">
            Custom foods are shared with everyone, so other MacroMate users can log them too.
          </p>
          <input
            value={newFood.name}
            onChange={(e) => setNewFood({ ...newFood, name: e.target.value })}
            placeholder="Name"
            aria-label="Custom food name"
            className="input w-full"
          />
          <input
            value={newFood.serving_description}
            onChange={(e) => setNewFood({ ...newFood, serving_description: e.target.value })}
            placeholder="Serving description (e.g. 1 bowl, 100g)"
            aria-label="Serving description"
            className="input w-full"
          />
          <div className="grid grid-cols-4 gap-2">
            <input
              value={newFood.calories}
              onChange={(e) => setNewFood({ ...newFood, calories: e.target.value })}
              placeholder="kcal"
              aria-label="Calories"
              type="number"
              min={0}
              className="input"
            />
            <input
              value={newFood.protein_g}
              onChange={(e) => setNewFood({ ...newFood, protein_g: e.target.value })}
              placeholder="Protein g"
              aria-label="Protein grams"
              type="number"
              min={0}
              className="input"
            />
            <input
              value={newFood.carbs_g}
              onChange={(e) => setNewFood({ ...newFood, carbs_g: e.target.value })}
              placeholder="Carbs g"
              aria-label="Carbs grams"
              type="number"
              min={0}
              className="input"
            />
            <input
              value={newFood.fat_g}
              onChange={(e) => setNewFood({ ...newFood, fat_g: e.target.value })}
              placeholder="Fat g"
              aria-label="Fat grams"
              type="number"
              min={0}
              className="input"
            />
          </div>

          {duplicates.length > 0 && (
            <div className="rounded-[var(--radius-control)] bg-surface-container p-2">
              <p className="mb-1 text-xs font-semibold text-on-surface">
                Similar foods already exist — log one of these instead, or create anyway:
              </p>
              <ul className="space-y-1">
                {duplicates.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between rounded-[var(--radius-control)] bg-surface-container-lowest px-2 py-1.5"
                  >
                    <span className="truncate text-xs text-on-surface">
                      {d.name} · {Math.round(d.calories)} kcal
                    </span>
                    <button
                      type="button"
                      onClick={() => quickAdd(d)}
                      className="ml-2 flex-shrink-0 rounded-full bg-primary-container px-2 py-0.5 text-xs font-semibold text-on-primary"
                    >
                      Log this
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => submitCreateFood(true)}
                disabled={creating}
                className="mt-2 text-xs font-semibold text-fat underline disabled:opacity-60"
              >
                Create anyway
              </button>
            </div>
          )}

          {createError && <p className="text-xs text-fat">{createError}</p>}

          {duplicates.length === 0 && (
            <button
              type="button"
              onClick={() => submitCreateFood(false)}
              disabled={creating}
              className="w-full rounded-[var(--radius-control)] bg-primary py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create food"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

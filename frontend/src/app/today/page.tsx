"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CreateFoodResponse,
  FoodItem,
  FoodLog,
  GlassSize,
  MealType,
  SuggestionsResponse,
  WaterSummary,
  createFood,
  createGlassSize,
  deleteFoodLog,
  fetchFoodLogs,
  fetchGlassSizes,
  fetchSuggestions,
  fetchWaterLogs,
  logFood,
  logWater,
  searchFoods,
  updateFoodLog,
} from "@/lib/api";
import { browserTimezone, localDateIso as todayIso } from "@/lib/date";
import { NumericField } from "@/components/NumericField";
import { WaterGlasses } from "@/components/WaterGlasses";
import { supabase } from "@/lib/supabaseClient";
import { useProfile } from "@/lib/useProfile";
import { useSession } from "@/lib/useSession";

const MACRO_ROWS: {
  key: "protein_g" | "carbs_g" | "fat_g";
  label: string;
  colorVar: string;
}[] = [
  { key: "protein_g", label: "Protein", colorVar: "var(--color-protein)" },
  { key: "carbs_g", label: "Carbs", colorVar: "var(--color-carbs)" },
  { key: "fat_g", label: "Fat", colorVar: "var(--color-fat)" },
];

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function inferMealType(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 18) return "snack";
  return "dinner";
}


export default function TodayPage() {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const profile = useProfile(session?.user.id);

  const [foodLogs, setFoodLogs] = useState<FoodLog[] | null>(null);
  const [water, setWater] = useState<WaterSummary | null>(null);
  const [glassSizes, setGlassSizes] = useState<GlassSize[] | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [logActionBusy, setLogActionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionLoading && !session) router.push("/login");
  }, [sessionLoading, session, router]);

  useEffect(() => {
    if (profile === null) router.push("/onboarding");
  }, [profile, router]);

  useEffect(() => {
    // Keep the stored timezone in sync with the browser's — covers users
    // onboarded before this field existed, and travel across timezones.
    // Silent best-effort: "today" boundaries fall back to UTC if this
    // never runs, they just won't match the user's local day.
    if (!profile || !session) return;
    const current = browserTimezone();
    if (profile.timezone !== current) {
      supabase.from("profiles").update({ timezone: current }).eq("id", session.user.id).then();
    }
  }, [profile, session]);

  async function reloadDay() {
    setLoadError(null);
    try {
      const [logs, waterSummary, glasses, suggestionsRes] = await Promise.all([
        fetchFoodLogs(todayIso()),
        fetchWaterLogs(todayIso()),
        fetchGlassSizes(),
        fetchSuggestions(),
      ]);
      setFoodLogs(logs);
      setWater(waterSummary);
      setGlassSizes(glasses);
      setSuggestions(suggestionsRes);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load today's data.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, standard pattern
    if (session && profile) reloadDay();
  }, [session, profile]);

  const consumed = useMemo(() => {
    const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    for (const log of foodLogs ?? []) {
      totals.calories += log.calories;
      totals.protein_g += log.protein_g;
      totals.carbs_g += log.carbs_g;
      totals.fat_g += log.fat_g;
    }
    return totals;
  }, [foodLogs]);

  if (sessionLoading || profile === undefined || !session) {
    return <p className="p-10 text-sm text-on-surface-variant">Loading…</p>;
  }
  if (!profile) {
    return <p className="p-10 text-sm text-on-surface-variant">Redirecting to onboarding…</p>;
  }

  const remainingCalories = Math.max(profile.target_calories - consumed.calories, 0);
  const percentOfTarget = Math.min(
    Math.round((consumed.calories / profile.target_calories) * 100),
    100,
  );
  const waterGoal = profile.water_goal_ml ?? 2500;
  const waterTotal = water?.total_ml ?? 0;

  async function handleSearch(q: string) {
    setQuery(q);
    setActionError(null);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchFoods(q));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function handleQuickLog(food: { id: string }) {
    setActionError(null);
    try {
      await logFood(food.id, inferMealType(), 1);
      setQuery("");
      setResults([]);
      await reloadDay();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't log that food.");
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
        setCreatedNotice(`"${res.created.name}" created — search for it above to log it.`);
        setNewFood({
          name: "",
          serving_description: "",
          calories: "",
          protein_g: "",
          carbs_g: "",
          fat_g: "",
        });
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

  async function handleQuickWater(volumeMl: number) {
    setActionError(null);
    try {
      await logWater(volumeMl);
      await reloadDay();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't log water.");
    }
  }

  async function handleSaveLogQuantity(logId: string, quantity: number) {
    if (quantity <= 0) return;
    setActionError(null);
    setLogActionBusy(logId);
    try {
      await updateFoodLog(logId, quantity);
      setEditingLogId(null);
      await reloadDay();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't update that entry.");
    } finally {
      setLogActionBusy(null);
    }
  }

  async function handleDeleteLog(log: FoodLog) {
    if (!window.confirm(`Remove ${log.food_name} from today's log?`)) return;
    setActionError(null);
    setLogActionBusy(log.id);
    try {
      await deleteFoodLog(log.id);
      if (editingLogId === log.id) setEditingLogId(null);
      await reloadDay();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't remove that entry.");
    } finally {
      setLogActionBusy(null);
    }
  }

  const mealsByType: Record<MealType, FoodLog[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const log of foodLogs ?? []) mealsByType[log.meal_type].push(log);

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl space-y-4 lg:max-w-5xl">
        <header className="pt-1">
          <p className="font-label-md text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </p>
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            Today&apos;s Balance
          </h1>
        </header>

        {loadError && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {loadError}{" "}
            <button onClick={reloadDay} className="font-semibold underline">
              Retry
            </button>
          </p>
        )}

        <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
        {/* Calorie hero card */}
        <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Energy budget
              </p>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold tracking-tight text-on-surface">
                  {remainingCalories}
                </span>
                <span className="text-base font-medium text-on-surface-variant">
                  kcal left
                </span>
              </div>
            </div>
            <div className="relative flex h-20 w-20 items-center justify-center">
              <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90 transform">
                <circle
                  cx="38"
                  cy="38"
                  r="32"
                  fill="transparent"
                  stroke="var(--color-surface-container-high)"
                  strokeWidth="7"
                />
                <circle
                  cx="38"
                  cy="38"
                  r="32"
                  fill="transparent"
                  stroke="var(--color-primary)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={201.06}
                  strokeDashoffset={201.06 * (1 - percentOfTarget / 100)}
                  className="transition-all duration-700"
                />
              </svg>
              <span className="absolute text-sm font-bold text-on-surface">
                {percentOfTarget}%
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 rounded-[var(--radius-control)] bg-surface-container-low p-2">
            <div className="px-2 py-1">
              <p className="text-xs text-on-surface-variant">Consumed</p>
              <p className="font-semibold text-on-surface" data-testid="consumed-calories">
                {Math.round(consumed.calories)}{" "}
                <span className="text-xs font-normal text-on-surface-variant">kcal</span>
              </p>
            </div>
            <div className="px-2 py-1">
              <p className="text-xs text-on-surface-variant">Daily goal</p>
              <p className="font-semibold text-on-surface">
                {profile.target_calories}{" "}
                <span className="text-xs font-normal text-on-surface-variant">kcal</span>
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {MACRO_ROWS.map(({ key, label, colorVar }) => {
              const target = profile[`target_${key}` as keyof typeof profile] as number;
              const value = consumed[key];
              const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 100) : 0;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-on-surface">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: colorVar }}
                      />
                      {label}
                    </span>
                    <span className="text-on-surface-variant">
                      <strong className="text-on-surface">{Math.round(value)}g</strong> /{" "}
                      {target}g
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: colorVar }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Quick food search / log */}
        <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-on-surface">Log food</h2>
          <input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search foods…"
            className="input w-full"
          />
          {searching && <p className="mt-2 text-xs text-on-surface-variant">Searching…</p>}
          {results.length > 0 && (
            <ul data-testid="food-search-results" className="mt-2 space-y-1">
              {results.map((food) => (
                <li
                  key={food.id}
                  className="flex items-center justify-between rounded-[var(--radius-control)] bg-surface-container-low px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-on-surface">
                      {food.name}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {food.serving_description} · {food.calories} kcal
                    </p>
                  </div>
                  <button
                    onClick={() => handleQuickLog(food)}
                    className="ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary"
                    aria-label={`Add ${food.name}`}
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
          )}
          {actionError && <p className="mt-2 text-xs text-fat">{actionError}</p>}

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

          {createdNotice && (
            <p className="mt-2 text-xs text-primary">{createdNotice}</p>
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
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <input
                value={newFood.name}
                onChange={(e) => setNewFood({ ...newFood, name: e.target.value })}
                placeholder="Name"
                aria-label="Custom food name"
                className="input w-full"
              />
              <input
                value={newFood.serving_description}
                onChange={(e) =>
                  setNewFood({ ...newFood, serving_description: e.target.value })
                }
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
                          {d.name} · {d.calories} kcal
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuickLog(d)}
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

        {/* Smart suggestions — deterministic constraint search, PRD §3.5 */}
        {suggestions && suggestions.suggestions.length > 0 && (
          <section className="rounded-[var(--radius-card)] border border-primary/25 bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-1.5 text-primary">
              <span className="material-symbols-outlined text-lg">psychology</span>
              <span className="text-xs font-bold uppercase tracking-wider">
                Suggestions for what&apos;s left
              </span>
            </div>
            <p className="mb-3 text-sm text-on-surface-variant">{suggestions.message}</p>
            <div className="space-y-2">
              {suggestions.suggestions.map((food) => (
                <div
                  key={food.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-container-low p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-on-surface">{food.name}</p>
                    <p className="text-xs text-on-surface-variant">
                      {food.calories} kcal · P {food.protein_g}g
                    </p>
                  </div>
                  <button
                    onClick={() => handleQuickLog(food)}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary"
                    aria-label={`Add ${food.name}`}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Hydration */}
        <WaterCard
          totalMl={waterTotal}
          goalMl={waterGoal}
          glassSizes={glassSizes ?? []}
          onQuickLog={handleQuickWater}
          onGlassAdded={reloadDay}
        />

        </div>

        {/* Meal timeline */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-on-surface">Today&apos;s meals</h2>
          {foodLogs === null ? (
            <p className="text-sm text-on-surface-variant">Loading…</p>
          ) : foodLogs.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-outline-variant p-4 text-sm text-on-surface-variant">
              Nothing logged yet today — search above to add your first meal.
            </p>
          ) : (
            (Object.keys(MEAL_LABELS) as MealType[]).map((mealType) =>
              mealsByType[mealType].length === 0 ? null : (
                <div
                  key={mealType}
                  className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm"
                >
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                    {MEAL_LABELS[mealType]}
                  </h3>
                  <ul className="space-y-2">
                    {mealsByType[mealType].map((log) =>
                      editingLogId === log.id ? (
                        <li key={log.id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate text-on-surface">
                            {log.food_name}
                          </span>
                          <NumericField
                            aria-label={`Quantity for ${log.food_name}`}
                            value={editQuantity}
                            min={0.1}
                            max={100}
                            onLiveChange={setEditQuantity}
                            onCommit={setEditQuantity}
                            className="input w-16 text-right"
                          />
                          <button
                            type="button"
                            disabled={logActionBusy === log.id}
                            onClick={() => handleSaveLogQuantity(log.id, editQuantity)}
                            aria-label={`Save ${log.food_name}`}
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary disabled:opacity-60"
                          >
                            <span className="material-symbols-outlined text-sm">check</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingLogId(null)}
                            aria-label="Cancel edit"
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
                          >
                            <span className="material-symbols-outlined text-sm">close</span>
                          </button>
                        </li>
                      ) : (
                        <li key={log.id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate text-on-surface">
                            {log.food_name}
                          </span>
                          <span className="flex-shrink-0 text-on-surface-variant">
                            {Math.round(log.calories)} kcal
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingLogId(log.id);
                              setEditQuantity(log.quantity);
                            }}
                            aria-label={`Edit ${log.food_name}`}
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={logActionBusy === log.id}
                            onClick={() => handleDeleteLog(log)}
                            aria-label={`Remove ${log.food_name}`}
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-fat disabled:opacity-60"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ),
            )
          )}
        </section>
      </div>
    </main>
  );
}

function WaterCard({
  totalMl,
  goalMl,
  glassSizes,
  onQuickLog,
  onGlassAdded,
}: {
  totalMl: number;
  goalMl: number;
  glassSizes: GlassSize[];
  onQuickLog: (ml: number) => void;
  onGlassAdded: () => void;
}) {
  const [addingSize, setAddingSize] = useState(false);
  const [label, setLabel] = useState("");
  const [volume, setVolume] = useState(250);

  async function handleAddSize(e: React.FormEvent) {
    e.preventDefault();
    await createGlassSize(label || `${volume}ml`, volume);
    setAddingSize(false);
    setLabel("");
    onGlassAdded();
  }

  const quickOptions = glassSizes.length > 0 ? glassSizes : [
    { id: "default-250", label: "250ml", volume_ml: 250 },
    { id: "default-500", label: "500ml", volume_ml: 500 },
  ];
  // The smallest configured container is what "a glass" means for this
  // user — visualizing hydration in terms of a 1000ml "big bottle" reads
  // wrong ("2 bottles" isn't the mental model "glasses" implies).
  const unitMl = quickOptions.reduce(
    (min, g) => Math.min(min, g.volume_ml),
    quickOptions[0]?.volume_ml ?? 250,
  );

  return (
    <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Hydration</h3>
          <p className="text-xs text-on-surface-variant">
            Daily target: {goalMl} ml · {unitMl} ml glass
          </p>
        </div>
        <span
          data-testid="water-total"
          className="font-display text-lg font-bold text-water"
        >
          {totalMl} <span className="text-xs font-normal text-on-surface-variant">ml</span>
        </span>
      </div>
      <div className="mt-3">
        <WaterGlasses totalMl={totalMl} unitMl={unitMl} goalMl={goalMl} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {quickOptions.map((g) => (
          <button
            key={g.id}
            onClick={() => onQuickLog(g.volume_ml)}
            className="rounded-[var(--radius-control)] bg-surface-container-low px-3 py-1.5 text-xs font-semibold text-water"
          >
            +{g.volume_ml}ml
          </button>
        ))}
        <button
          onClick={() => setAddingSize((v) => !v)}
          className="rounded-[var(--radius-control)] border border-dashed border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant"
        >
          + Custom size
        </button>
      </div>
      {addingSize && (
        <form onSubmit={handleAddSize} className="mt-3 flex items-end gap-2">
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
            Volume (ml)
            <NumericField min={1} max={5000} value={volume} onCommit={setVolume} className="input w-24" />
          </label>
          <button
            type="submit"
            className="rounded-[var(--radius-control)] bg-primary px-3 py-2 text-xs font-semibold text-on-primary"
          >
            Save
          </button>
        </form>
      )}
    </section>
  );
}

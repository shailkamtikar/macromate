"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FoodItem,
  FoodLog,
  GlassSize,
  MealType,
  SuggestionsResponse,
  WaterSummary,
  createGlassSize,
  fetchFoodLogs,
  fetchGlassSizes,
  fetchSuggestions,
  fetchWaterLogs,
  logFood,
  logWater,
  searchFoods,
} from "@/lib/api";
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

  useEffect(() => {
    if (!sessionLoading && !session) router.push("/login");
  }, [sessionLoading, session, router]);

  useEffect(() => {
    if (profile === null) router.push("/onboarding");
  }, [profile, router]);

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
  const waterPercent = Math.min(Math.round((waterTotal / waterGoal) * 100), 100);

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

  async function handleQuickWater(volumeMl: number) {
    setActionError(null);
    try {
      await logWater(volumeMl);
      await reloadDay();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't log water.");
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
      <div className="w-full max-w-2xl space-y-4">
        <header className="flex items-center justify-between pt-1">
          <div>
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
          </div>
          <a
            href="/profile"
            aria-label="Profile & settings"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-xl">person</span>
          </a>
        </header>

        {loadError && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {loadError}{" "}
            <button onClick={reloadDay} className="font-semibold underline">
              Retry
            </button>
          </p>
        )}

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
              <p className="font-semibold text-on-surface">
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
          percent={waterPercent}
          glassSizes={glassSizes ?? []}
          onQuickLog={handleQuickWater}
          onGlassAdded={reloadDay}
        />

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
                    {mealsByType[mealType].map((log) => (
                      <li key={log.id} className="flex items-center justify-between text-sm">
                        <span className="text-on-surface">{log.food_name}</span>
                        <span className="text-on-surface-variant">
                          {Math.round(log.calories)} kcal
                        </span>
                      </li>
                    ))}
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
  percent,
  glassSizes,
  onQuickLog,
  onGlassAdded,
}: {
  totalMl: number;
  goalMl: number;
  percent: number;
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

  return (
    <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Hydration</h3>
          <p className="text-xs text-on-surface-variant">Daily target: {goalMl} ml</p>
        </div>
        <span
          data-testid="water-total"
          className="font-display text-lg font-bold text-water"
        >
          {totalMl} <span className="text-xs font-normal text-on-surface-variant">ml</span>
        </span>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-container">
        <div
          className="h-full rounded-full bg-water transition-all"
          style={{ width: `${percent}%` }}
        />
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
            <input
              type="number"
              min={1}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="input w-24"
            />
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

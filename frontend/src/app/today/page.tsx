"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Achievements,
  FoodLog,
  GlassSize,
  MealType,
  SuggestedFood,
  SuggestionsResponse,
  WaterSummary,
  createGlassSize,
  deleteFoodLog,
  fetchAchievements,
  fetchFoodLogs,
  fetchGlassSizes,
  fetchSuggestions,
  fetchWaterLogs,
  logFood,
  logWater,
  removeWater,
  updateFoodLog,
} from "@/lib/api";
import { browserTimezone, localDateIso as todayIso } from "@/lib/date";
import { friendlyMessage } from "@/lib/errors";
import { MEAL_TYPES, inferMealType } from "@/lib/servings";
import { nextTempId } from "@/lib/tempId";
import { BootstrapLoader } from "@/components/BootstrapLoader";
import { DiaryMeal } from "@/components/DiaryMeal";
import { FoodPicker } from "@/components/FoodPicker";
import { NumericField } from "@/components/NumericField";
import { WaterGlasses } from "@/components/WaterGlasses";
import { StreakChip } from "@/components/AchievementsCard";
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

export default function TodayPage() {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const profile = useProfile(session?.user.id);

  const [foodLogs, setFoodLogs] = useState<FoodLog[] | null>(null);
  const [water, setWater] = useState<WaterSummary | null>(null);
  const [glassSizes, setGlassSizes] = useState<GlassSize[] | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logActionBusy, setLogActionBusy] = useState<string | null>(null);

  // Starts at a fixed value so the server-rendered markup is deterministic,
  // then snaps to the meal that matches the current time of day once we're
  // on the client (the server's clock/timezone isn't the user's).
  const [pickerMeal, setPickerMeal] = useState<MealType>("breakfast");
  const [diaryVersion, setDiaryVersion] = useState(0);
  const [achievements, setAchievements] = useState<Achievements | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  // Bumped synchronously by every optimistic mutation below. loadDay()'s
  // Promise.all can take a while (fetchSuggestions in particular), and it
  // only ever runs once on mount -- but "once on mount" can still resolve
  // *after* a mutation the user fired off while it was in flight. Without
  // this guard, that stale response would overwrite the fresher optimistic
  // state with a pre-mutation snapshot.
  const mutationVersion = useRef(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only time-of-day default, deliberately not computed during SSR
    setPickerMeal(inferMealType());
  }, []);

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

  // Full fetch of all four domains -- used only for the initial mount and
  // the manual "Retry" link after a load failure. Every mutation below
  // instead applies an optimistic update and/or a single targeted refetch
  // of just the domain(s) it can actually affect, rather than reloading
  // everything on every click (see the audit finding this replaces).
  async function loadDay() {
    setLoadError(null);
    const startVersion = mutationVersion.current;
    try {
      const [logs, waterSummary, glasses, suggestionsRes] = await Promise.all([
        fetchFoodLogs(todayIso()),
        fetchWaterLogs(todayIso()),
        fetchGlassSizes(),
        fetchSuggestions(),
      ]);
      // A mutation landed while this fetch was in flight -- its optimistic
      // state is newer than this response, so applying it now would revert
      // real, user-visible changes. Bail out; the mutation's own state
      // update is already authoritative-enough (and, where relevant, has
      // its own targeted refetch).
      if (mutationVersion.current !== startVersion) return;
      setFoodLogs(logs);
      setWater(waterSummary);
      setGlassSizes(glasses);
      setSuggestions(suggestionsRes);
      setDiaryVersion((v) => v + 1);
    } catch (err) {
      if (mutationVersion.current !== startVersion) return;
      setLoadError(friendlyMessage(err, "diary-load"));
    }
  }

  // Suggestions depend on today's remaining calories/macros, so only a food
  // mutation ever needs to refresh them -- never water or glass-size
  // changes, which can't affect what's "left" to eat. Best-effort: a
  // failure here shouldn't blow away an otherwise-successful food action.
  async function refreshSuggestions() {
    try {
      setSuggestions(await fetchSuggestions());
    } catch {
      // Keep showing the previous suggestions rather than erroring the
      // whole page over a non-critical, supplementary fetch.
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, standard pattern
    if (session && profile) loadDay();
  }, [session, profile]);

  useEffect(() => {
    // Lightweight, best-effort: the streak chip is a nice-to-have, so a
    // failure here should never surface as a page error. Achievements
    // (streak, calorie/macro goal hits) only depend on food logs, so this
    // is keyed on diaryVersion, which now only bumps for food mutations --
    // not water or glass-size changes, which can't affect it.
    if (!session) return;
    fetchAchievements()
      .then(setAchievements)
      .catch(() => {});
  }, [session, diaryVersion]);

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

  const mealsByType = useMemo(() => {
    const grouped: Record<MealType, FoodLog[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };
    for (const log of foodLogs ?? []) grouped[log.meal_type].push(log);
    return grouped;
  }, [foodLogs]);

  // Session resolution is already handled once, app-wide, by AppShell's
  // BootstrapLoader gate (see SessionProvider); profile is likewise
  // resolved once per session by ProfileProvider, not refetched on every
  // navigation -- so this branch is now a genuine, once-per-session
  // bootstrap moment rather than something that would otherwise flash on
  // every visit to Today, and the same branded loader is appropriate here.
  if (sessionLoading || profile === undefined || !session) {
    return <BootstrapLoader />;
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
  // Distinguishes "genuinely 0 ml logged" from "hasn't loaded yet" --
  // waterTotal alone can't, since both render as 0. A click in that brief
  // initial window would otherwise optimistically no-op (setWater's
  // functional update is a no-op while `water` is still null) with no
  // visible feedback and no request correction until the next mutation.
  const waterLoaded = water !== null;

  // Water total is a plain sum, so the optimistic delta *is* the correct
  // total (not a guess to be corrected) -- logWater's response doesn't
  // carry an aggregate to reconcile against anyway. Rollback restores the
  // exact delta rather than an older snapshot, so it can't clobber another
  // still-in-flight water mutation.
  async function handleQuickWater(volumeMl: number) {
    setActionError(null);
    mutationVersion.current += 1;
    setWater((prev) => (prev ? { ...prev, total_ml: prev.total_ml + volumeMl } : prev));
    try {
      await logWater(volumeMl);
    } catch (err) {
      setWater((prev) => (prev ? { ...prev, total_ml: prev.total_ml - volumeMl } : prev));
      setActionError(friendlyMessage(err, "water-log"));
    }
  }

  async function handleRemoveWater(volumeMl: number) {
    setActionError(null);
    mutationVersion.current += 1;
    setWater((prev) => (prev ? { ...prev, total_ml: Math.max(0, prev.total_ml - volumeMl) } : prev));
    try {
      // Unlike logWater, removeWater's response IS the server's own
      // recomputed summary -- use it as the authoritative correction
      // rather than trusting the optimistic subtraction indefinitely.
      const summary = await removeWater(volumeMl);
      setWater(summary);
    } catch (err) {
      setWater((prev) => (prev ? { ...prev, total_ml: prev.total_ml + volumeMl } : prev));
      setActionError(friendlyMessage(err, "water-log"));
    }
  }

  async function handleAddGlassSize(label: string, volumeMl: number) {
    setActionError(null);
    mutationVersion.current += 1;
    const tempId = nextTempId();
    setGlassSizes((prev) => [...(prev ?? []), { id: tempId, label, volume_ml: volumeMl }]);
    try {
      const created = await createGlassSize(label, volumeMl);
      setGlassSizes((prev) => (prev ?? []).map((g) => (g.id === tempId ? created : g)));
    } catch (err) {
      setGlassSizes((prev) => (prev ?? []).filter((g) => g.id !== tempId));
      setActionError(friendlyMessage(err, "glass-size"));
    }
  }

  function handleFoodLogStart(entry: FoodLog) {
    setActionError(null);
    mutationVersion.current += 1;
    setFoodLogs((prev) => [...(prev ?? []), entry]);
  }

  function handleFoodLogSuccess(tempId: string, real: FoodLog) {
    setFoodLogs((prev) => (prev ?? []).map((l) => (l.id === tempId ? real : l)));
    setDiaryVersion((v) => v + 1);
    refreshSuggestions();
  }

  function handleFoodLogError(tempId: string, err: unknown) {
    setFoodLogs((prev) => (prev ?? []).filter((l) => l.id !== tempId));
    setActionError(friendlyMessage(err, "food-log-save"));
  }

  async function handleSaveEntry(
    logId: string,
    changes: { quantity?: number; meal_type?: MealType },
  ) {
    setActionError(null);
    mutationVersion.current += 1;
    setLogActionBusy(logId);
    let previous: FoodLog | undefined;
    setFoodLogs((prev) =>
      (prev ?? []).map((l) => {
        if (l.id !== logId) return l;
        previous = l;
        // A quantity change scales the logged nutrition proportionally --
        // the exact same arithmetic the server applies -- so the
        // optimistic row already shows the real post-edit numbers, not a
        // placeholder, while the request is in flight.
        const ratio =
          changes.quantity !== undefined && l.quantity > 0 ? changes.quantity / l.quantity : 1;
        return {
          ...l,
          quantity: changes.quantity ?? l.quantity,
          meal_type: changes.meal_type ?? l.meal_type,
          calories: l.calories * ratio,
          protein_g: l.protein_g * ratio,
          carbs_g: l.carbs_g * ratio,
          fat_g: l.fat_g * ratio,
        };
      }),
    );
    try {
      const updated = await updateFoodLog(logId, changes);
      setFoodLogs((prev) => (prev ?? []).map((l) => (l.id === logId ? updated : l)));
      if (changes.quantity !== undefined) await refreshSuggestions();
    } catch (err) {
      setFoodLogs((prev) => (prev ?? []).map((l) => (l.id === logId && previous ? previous : l)));
      setActionError(friendlyMessage(err, "food-log-update"));
    } finally {
      setLogActionBusy(null);
    }
  }

  async function handleDeleteEntry(log: FoodLog) {
    if (!window.confirm(`Remove ${log.food_name} from today's diary?`)) return;
    setActionError(null);
    mutationVersion.current += 1;
    setLogActionBusy(log.id);
    setFoodLogs((prev) => (prev ?? []).filter((l) => l.id !== log.id));
    try {
      await deleteFoodLog(log.id);
      setDiaryVersion((v) => v + 1);
      await refreshSuggestions();
    } catch (err) {
      setFoodLogs((prev) => (prev ? [...prev, log] : prev));
      setActionError(friendlyMessage(err, "food-log-delete"));
    } finally {
      setLogActionBusy(null);
    }
  }

  async function handleSuggestionAdd(food: SuggestedFood) {
    setActionError(null);
    mutationVersion.current += 1;
    const tempId = nextTempId();
    const mealType = inferMealType();
    setFoodLogs((prev) => [
      ...(prev ?? []),
      {
        id: tempId,
        food_item_id: food.id,
        food_name: food.name,
        meal_type: mealType,
        quantity: 1,
        calories: food.calories,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fat_g: food.fat_g,
        logged_at: new Date().toISOString(),
        source: "database",
        serving_description: food.serving_description,
      },
    ]);
    try {
      const log = await logFood(food.id, mealType, 1);
      setFoodLogs((prev) => (prev ?? []).map((l) => (l.id === tempId ? log : l)));
      setDiaryVersion((v) => v + 1);
      await refreshSuggestions();
    } catch (err) {
      setFoodLogs((prev) => (prev ?? []).filter((l) => l.id !== tempId));
      setActionError(friendlyMessage(err, "food-log-save"));
    }
  }

  function focusPickerOn(meal: MealType) {
    setPickerMeal(meal);
    pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl space-y-4 lg:max-w-6xl">
        <header className="flex items-start justify-between pt-1">
          <div>
            <p className="font-label-md text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
            <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
              Today&apos;s Diary
            </h1>
          </div>
          {achievements && <StreakChip achievements={achievements} />}
        </header>

        {loadError && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {loadError}{" "}
            <button onClick={loadDay} className="font-semibold underline">
              Retry
            </button>
          </p>
        )}
        {actionError && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {actionError}
          </p>
        )}

        <div className="lg:grid lg:grid-cols-3 lg:items-start lg:gap-4">
          {/* Diary column */}
          <div className="space-y-4 lg:col-span-2">
            {/* Daily totals */}
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

            {/* Meal-by-meal diary */}
            {foodLogs === null ? (
              <p className="text-sm text-on-surface-variant">Loading your diary…</p>
            ) : (
              <div data-testid="diary" className="space-y-4">
                {MEAL_TYPES.map((meal) => (
                  <DiaryMeal
                    key={meal}
                    meal={meal}
                    entries={mealsByType[meal]}
                    busyLogId={logActionBusy}
                    onSave={handleSaveEntry}
                    onDelete={handleDeleteEntry}
                    onAddFood={focusPickerOn}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Logging column */}
          <div className="mt-4 space-y-4 lg:mt-0">
            <div ref={pickerRef}>
              <FoodPicker
                meal={pickerMeal}
                onMealChange={setPickerMeal}
                onLogStart={handleFoodLogStart}
                onLogSuccess={handleFoodLogSuccess}
                onLogError={handleFoodLogError}
                refreshKey={diaryVersion}
              />
            </div>

            <WaterCard
              totalMl={waterTotal}
              goalMl={waterGoal}
              glassSizes={glassSizes ?? []}
              onQuickLog={handleQuickWater}
              onRemove={handleRemoveWater}
              onAddGlassSize={handleAddGlassSize}
              disabled={!waterLoaded}
            />

            {suggestions && (
              <section
                data-testid="suggestions-card"
                className="rounded-[var(--radius-card)] border border-primary/25 bg-surface-container-lowest p-5 shadow-sm"
              >
                <div className="mb-1 flex items-center gap-1.5 text-primary">
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">psychology</span>
                  <span className="text-xs font-bold uppercase tracking-wider">
                    What to eat next
                  </span>
                </div>
                <p className="mb-1 text-xs text-on-surface-variant">
                  Based on what&apos;s left today: {suggestions.remaining_calories} kcal
                  {suggestions.protein_is_priority
                    ? ` · ${suggestions.remaining_protein_g}g protein still needed`
                    : " · protein goal on track"}
                </p>
                <p
                  data-testid="suggestions-message"
                  className="mb-3 text-sm text-on-surface-variant"
                >
                  {suggestions.message}
                </p>
                {suggestions.suggestions.length > 0 && (
                  <div className="space-y-2">
                    {suggestions.suggestions.map((food) => (
                      <div
                        key={food.id}
                        className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-container-low p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-on-surface">
                            {food.name}
                          </p>
                          <p className="text-xs text-on-surface-variant">
                            {Math.round(food.calories)} kcal · P {Math.round(food.protein_g)}g
                          </p>
                        </div>
                        <button
                          onClick={() => handleSuggestionAdd(food)}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary"
                          aria-label={`Add ${food.name}`}
                        >
                          +
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function WaterCard({
  totalMl,
  goalMl,
  glassSizes,
  onQuickLog,
  onRemove,
  onAddGlassSize,
  disabled,
}: {
  totalMl: number;
  goalMl: number;
  glassSizes: GlassSize[];
  onQuickLog: (ml: number) => void;
  onRemove: (ml: number) => void;
  onAddGlassSize: (label: string, volumeMl: number) => void;
  /** True only until the initial water fetch resolves -- NOT held during a
   * mutation's own round-trip (those are optimistic and stay interactive).
   * Without this, a click in that brief initial window would silently
   * no-op (see the comment on `waterLoaded` in the parent). */
  disabled?: boolean;
}) {
  const [addingSize, setAddingSize] = useState(false);
  const [label, setLabel] = useState("");
  const [volume, setVolume] = useState(250);

  function handleAddSize(e: React.FormEvent) {
    e.preventDefault();
    onAddGlassSize(label || `${volume}ml`, volume);
    setAddingSize(false);
    setLabel("");
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
  const glassesDone = unitMl > 0 ? totalMl / unitMl : 0;
  const glassesGoal = unitMl > 0 ? Math.max(1, Math.round(goalMl / unitMl)) : 1;

  return (
    <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Hydration</h3>
          <p className="text-xs text-on-surface-variant">
            {Math.round(glassesDone * 10) / 10} of {glassesGoal} glasses · {unitMl} ml each
          </p>
        </div>
        <span
          data-testid="water-total"
          className="font-display text-lg font-bold text-water"
        >
          {totalMl} <span className="text-xs font-normal text-on-surface-variant">ml</span>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-on-surface-variant">Daily target: {goalMl} ml</p>
      <div className="mt-3">
        <WaterGlasses
          totalMl={totalMl}
          unitMl={unitMl}
          goalMl={goalMl}
          onAdd={() => onQuickLog(unitMl)}
          onRemove={totalMl > 0 ? () => onRemove(unitMl) : undefined}
          disabled={disabled}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {quickOptions.map((g) => (
          <button
            key={g.id}
            onClick={() => onQuickLog(g.volume_ml)}
            disabled={disabled}
            className="rounded-[var(--radius-control)] bg-surface-container-low px-3 py-1.5 text-xs font-semibold text-water disabled:opacity-50"
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
        <form onSubmit={handleAddSize} className="mt-3 flex flex-wrap items-end gap-2">
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

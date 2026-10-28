"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FoodLog, GlassSize, MealType } from "@/lib/api";
import { browserTimezone, formatDayLong, isValidIso, localDateIso } from "@/lib/date";
import { MEAL_TYPES, inferMealType } from "@/lib/servings";
import { DateStrip } from "@/components/DateStrip";
import { DiaryMeal } from "@/components/DiaryMeal";
import { FoodPicker } from "@/components/FoodPicker";
import { NumericField } from "@/components/NumericField";
import { WaterGlasses } from "@/components/WaterGlasses";
import { StreakChip } from "@/components/AchievementsCard";
import { Skeleton } from "@/components/Skeleton";
import { SuggestionsCard } from "@/components/SuggestionsCard";
import { SlowStartHint } from "@/components/WarmPing";
import { supabase } from "@/lib/supabaseClient";
import { useDay } from "@/lib/useDay";
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
  // useSearchParams needs a Suspense boundary; the skeleton doubles as its
  // fallback so there is never a blank frame.
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <TodayPageInner />
    </Suspense>
  );
}

function TodayPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading: sessionLoading } = useSession();
  const profile = useProfile(session?.user.id);

  // The selected day lives in the URL (?date=YYYY-MM-DD) so it survives a
  // reload, can be bookmarked/shared, and the back button works. Anything
  // invalid or in the future falls back to today.
  const today = localDateIso();
  const rawDate = searchParams.get("date");
  const date = isValidIso(rawDate) && rawDate <= today ? rawDate : today;

  const {
    day,
    isToday,
    loadError,
    retry,
    suggestions,
    suggestionsLoading,
    suggestionsError,
    retrySuggestions,
    achievements,
    actionError,
    logActionBusy,
    diaryVersion,
    quickWater,
    undoWater,
    addGlassSize,
    foodLogStart,
    foodLogSuccess,
    foodLogError,
    saveEntry,
    deleteEntry,
    addSuggestion,
  } = useDay(date, !!session && !!profile);

  // Starts at a fixed value so the server-rendered markup is deterministic,
  // then snaps to the meal that matches the current time of day once we're
  // on the client (the server's clock/timezone isn't the user's).
  const [pickerMeal, setPickerMeal] = useState<MealType>("breakfast");
  const pickerRef = useRef<HTMLDivElement | null>(null);

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

  function selectDate(iso: string) {
    const target = iso > today ? today : iso;
    router.replace(target === today ? "/today" : `/today?date=${target}`, { scroll: false });
  }

  // Derived straight from the day's entries, so optimistic edits update the
  // totals in the same render.
  const foodLogs = day?.meals ?? null;
  const water = day?.water ?? null;
  const glassSizes = day?.glass_sizes ?? null;

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
  // gate (see SessionProvider); profile is likewise resolved once per
  // session by ProfileProvider -- so this is a genuine once-per-session
  // bootstrap moment, shown as a page-shaped skeleton.
  if (sessionLoading || profile === undefined || !session) {
    return <TodaySkeleton />;
  }
  if (!profile) {
    return <p className="p-10 text-sm text-on-surface-variant">Redirecting to onboarding…</p>;
  }

  // The day's own targets (history-aware); the profile's current targets
  // only until the day has loaded.
  const targets = day?.targets ?? {
    calories: profile.target_calories,
    protein_g: profile.target_protein_g,
    carbs_g: profile.target_carbs_g,
    fat_g: profile.target_fat_g,
    water_goal_ml: profile.water_goal_ml,
    is_approximate: false,
  };
  const remainingCalories = Math.max(targets.calories - consumed.calories, 0);
  const percentOfTarget = Math.min(
    Math.round((consumed.calories / targets.calories) * 100),
    100,
  );
  const waterGoal = targets.water_goal_ml ?? profile.water_goal_ml ?? 2500;
  const waterTotal = water?.total_ml ?? 0;
  // Distinguishes "genuinely 0 ml logged" from "hasn't loaded yet" --
  // waterTotal alone can't, since both render as 0.
  const waterLoaded = water !== null;

  const handleQuickWater = quickWater;
  const handleRemoveWater = undoWater;
  const handleAddGlassSize = addGlassSize;
  const handleFoodLogStart = foodLogStart;
  const handleFoodLogSuccess = foodLogSuccess;
  const handleFoodLogError = foodLogError;
  const handleSaveEntry = saveEntry;
  const handleSuggestionAdd = addSuggestion;

  async function handleDeleteEntry(log: FoodLog) {
    if (!window.confirm(`Remove ${log.food_name} from ${isToday ? "today's" : "this day's"} diary?`)) return;
    await deleteEntry(log);
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
              {formatDayLong(date)}
            </p>
            <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
              {isToday ? "Today's Diary" : "Diary"}
            </h1>
            {!isToday && (
              <p className="mt-1 flex items-center gap-2 text-xs text-on-surface-variant">
                <span className="rounded-full bg-surface-container px-2 py-0.5 font-medium">
                  Viewing a past day
                </span>
                <button
                  type="button"
                  onClick={() => selectDate(today)}
                  className="font-semibold text-primary"
                >
                  Back to today
                </button>
              </p>
            )}
          </div>
          {isToday && achievements && <StreakChip achievements={achievements} />}
        </header>

        <DateStrip selected={date} today={today} onSelect={selectDate} />

        {loadError && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {loadError}{" "}
            <button onClick={() => retry()} className="font-semibold underline">
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
            {foodLogs === null ? (
              <EnergyCardSkeleton />
            ) : (
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
                    {targets.calories}{" "}
                    <span className="text-xs font-normal text-on-surface-variant">kcal</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {MACRO_ROWS.map(({ key, label, colorVar }) => {
                  const target = (targets[key] ?? 0) as number;
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
            )}

            {!isToday && targets.is_approximate && (
              <p className="text-xs text-on-surface-variant">
                Targets for days before your target history began are approximate.
              </p>
            )}

            {/* Meal-by-meal diary */}
            {foodLogs === null ? (
              <div aria-busy="true" className="space-y-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : (
              <div data-testid="diary" className="space-y-4">
                {foodLogs.length === 0 && (
                  <div
                    data-testid="empty-day"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-dashed border-outline-variant bg-surface-container-lowest p-4"
                  >
                    <p className="text-sm text-on-surface-variant">
                      {isToday ? "Nothing logged yet today." : "Nothing was logged on this day."}
                    </p>
                    <button
                      type="button"
                      onClick={() => focusPickerOn(pickerMeal)}
                      className="rounded-[var(--radius-control)] bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary"
                    >
                      {isToday ? "Add food" : "Add food for this day"}
                    </button>
                  </div>
                )}
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
                logDate={isToday ? undefined : date}
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

            {isToday && (
              <SuggestionsCard
                data={suggestions}
                loading={suggestionsLoading}
                error={suggestionsError}
                onRetry={retrySuggestions}
                onAdd={handleSuggestionAdd}
              />
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

function EnergyCardSkeleton() {
  return (
    <section
      aria-busy="true"
      className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="h-20 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-14 w-full" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </section>
  );
}

/** Page-shaped placeholder shown while the session/profile resolve, so the
 * dashboard has its final layout from the first paint. */
function TodaySkeleton() {
  return (
    <main aria-busy="true" className="flex flex-1 justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl space-y-4 lg:max-w-6xl">
        <div className="space-y-2 pt-1">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-44" />
          <SlowStartHint />
        </div>
        <div className="lg:grid lg:grid-cols-3 lg:items-start lg:gap-4">
          <div className="space-y-4 lg:col-span-2">
            <EnergyCardSkeleton />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <div className="mt-4 space-y-4 lg:mt-0">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading your diary…
      </span>
    </main>
  );
}

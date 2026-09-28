"use client";

import { useEffect, useRef, useState } from "react";
import {
  ActivityLevel,
  BiologicalSex,
  Goal,
  MACRO_CALORIE_TOLERANCE_PCT,
  MIN_SAFE_DAILY_CALORIES,
  MacroMode,
  MacroTargetsResponse,
  fetchMacroTargets,
} from "@/lib/api";
import { NumericField } from "@/components/NumericField";
import { friendlyMessage } from "@/lib/errors";

interface TargetsEditorProps {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: BiologicalSex;
  activityLevel: ActivityLevel;
  goal: Goal;
  rateKgPerWeek: number | null;
  onResult: (result: MacroTargetsResponse | null) => void;
  onMacroModeChange?: (mode: MacroMode) => void;
  initialCalorieOverride?: number | null;
  initialMacroMode?: MacroMode;
  initialCustomMacros?: { protein_g: number; carbs_g: number; fat_g: number } | null;
}

const MACRO_META: {
  key: "protein_g" | "carbs_g" | "fat_g";
  label: string;
  colorVar: string;
  kcalPerGram: number;
}[] = [
  { key: "protein_g", label: "Protein", colorVar: "var(--color-protein)", kcalPerGram: 4 },
  { key: "carbs_g", label: "Carbs", colorVar: "var(--color-carbs)", kcalPerGram: 4 },
  { key: "fat_g", label: "Fat", colorVar: "var(--color-fat)", kcalPerGram: 9 },
];

export function TargetsEditor({
  weightKg,
  heightCm,
  ageYears,
  sex,
  activityLevel,
  goal,
  rateKgPerWeek,
  onResult,
  onMacroModeChange,
  initialCalorieOverride = null,
  initialMacroMode = "automatic",
  initialCustomMacros = null,
}: TargetsEditorProps) {
  const [calorieOverride, setCalorieOverride] = useState<number | null>(initialCalorieOverride);
  const [macroMode, setMacroMode] = useState<MacroMode>(initialMacroMode);
  const [customProtein, setCustomProtein] = useState(
    String(initialCustomMacros?.protein_g ?? ""),
  );
  const [customCarbs, setCustomCarbs] = useState(String(initialCustomMacros?.carbs_g ?? ""));
  const [customFat, setCustomFat] = useState(String(initialCustomMacros?.fat_g ?? ""));

  // Tracks whether the calorie value came from the user directly moving
  // the slider/typing a number (vs. being pre-filled from a previously
  // saved target on mount). A pre-filled value can legitimately fall
  // outside the *freshly recomputed* recommendation's tolerance band — the
  // recommendation may have shifted since it was saved (weight/activity
  // changed) — so on load we silently reconcile it against the current
  // recommendation instead of surfacing a confusing error before the user
  // has touched anything. Once they interact directly, normal validation
  // (and its error messaging) applies to every further change.
  const userEditedCaloriesRef = useRef(false);

  const [result, setResult] = useState<MacroTargetsResponse | null>(null);
  // The *bare* (no override/custom-macro) response — kept separately from
  // `result` and never cleared by an override/custom-macro validation
  // failure, since the recommendation itself is still valid even when the
  // user's chosen calories/macros aren't, and the UI (slider bounds,
  // "recommended vs selected", the capped-rate/low-calorie messaging)
  // needs it to stay on screen regardless.
  const [recommendedInfo, setRecommendedInfo] = useState<MacroTargetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Invalidate any previously confirmed result the instant an input
    // changes — it no longer reflects what's on screen. Otherwise the
    // Save button could stay enabled on a stale, no-longer-accurate
    // result for the whole debounce+fetch window (the displayed
    // "N kcal below recommended" text updates instantly and client-side,
    // well before the recalculated target actually comes back).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate synchronous invalidation, not data-fetch sync
    setResult(null);
    onResult(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // A cut/bulk goal requires a chosen pace before a target calculation
    // means anything -- never run the calculation (and never silently fall
    // back to a generic adjustment) while that rate hasn't been set yet.
    if (goal !== "maintain" && rateKgPerWeek === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      setError(null);
      const custom =
        macroMode === "custom"
          ? {
              custom_protein_g: Number(customProtein) || 0,
              custom_carbs_g: Number(customCarbs) || 0,
              custom_fat_g: Number(customFat) || 0,
            }
          : {};
      const basis = {
        weight_kg: weightKg,
        height_cm: heightCm,
        age_years: ageYears,
        sex,
        activity_level: activityLevel,
        goal,
        rate_kg_per_week: goal === "maintain" ? null : rateKgPerWeek,
      };

      async function run() {
        // Always resolved independently of whatever override/custom macros
        // are currently set, so it stays available even if the "real"
        // call below fails validation.
        const bare = await fetchMacroTargets(basis);
        setRecommendedInfo(bare);

        let effectiveOverride = calorieOverride;
        if (effectiveOverride !== null && !userEditedCaloriesRef.current) {
          // Reconcile a pre-filled (not user-edited) override against the
          // *current* recommendation before using it as an override. The
          // floor here is the flat absolute safety minimum — never
          // BMR-derived, which would let a low-TDEE user's own resting
          // rate silently determine (and corrupt) the editable range.
          const min = Math.max(bare.recommended_calories - 500, MIN_SAFE_DAILY_CALORIES);
          const max = bare.recommended_calories + 500;
          const clamped = Math.min(Math.max(effectiveOverride, min), max);
          if (clamped !== effectiveOverride) {
            effectiveOverride = clamped;
            setCalorieOverride(clamped);
          }
        }

        return fetchMacroTargets({
          ...basis,
          calorie_override: effectiveOverride,
          macro_mode: macroMode,
          ...custom,
        });
      }

      run()
        .then((res) => {
          setResult(res);
          onResult(res);
        })
        .catch((err) => {
          setResult(null);
          onResult(null);
          setError(friendlyMessage(err, "goals-calculate"));
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    weightKg,
    heightCm,
    ageYears,
    sex,
    activityLevel,
    goal,
    rateKgPerWeek,
    calorieOverride,
    macroMode,
    customProtein,
    customCarbs,
    customFat,
  ]);

  const recommended = recommendedInfo?.recommended_calories ?? null;
  const selectedCalories = calorieOverride ?? recommended ?? 0;
  // The manual slider's *typical* editable range is a UX convenience, not
  // the calculation itself — it always tracks the current recommendation
  // (±500 kcal) rather than a fixed band, so it stays meaningful for both
  // a naturally low and a naturally high recommended value. The absolute
  // floor is flat (never derived from this user's own BMR).
  const sliderMin = recommended
    ? Math.max(recommended - 500, MIN_SAFE_DAILY_CALORIES)
    : MIN_SAFE_DAILY_CALORIES;
  const sliderMax = recommended ? recommended + 500 : 3500;

  const impliedCalories =
    macroMode === "custom"
      ? (Number(customProtein) || 0) * 4 + (Number(customCarbs) || 0) * 4 + (Number(customFat) || 0) * 9
      : null;
  const customOffTarget =
    impliedCalories !== null && selectedCalories > 0
      ? Math.abs(impliedCalories - selectedCalories) / selectedCalories > MACRO_CALORIE_TOLERANCE_PCT
      : false;

  const finalLowCalorieWarning = result?.low_calorie_warning ?? recommendedInfo?.low_calorie_warning ?? null;
  const missingRate = goal !== "maintain" && rateKgPerWeek === null;

  if (missingRate) {
    return (
      <p className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-3 text-xs text-on-surface-variant">
        Choose a weekly pace above to calculate your targets.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {recommendedInfo?.is_rate_capped && recommendedInfo.cap_explanation && (
        <div
          data-testid="rate-cap-banner"
          className="rounded-[var(--radius-card)] border border-carbs/40 bg-carbs/10 p-3 text-xs text-on-surface"
        >
          <p className="font-semibold">
            Requested: {formatRateLabel(goal, recommendedInfo.requested_rate_kg_per_week)}
          </p>
          {recommendedInfo.applied_rate_kg_per_week !== null && (
            <p className="mt-0.5">
              Recommended maximum: {formatRateLabel(goal, recommendedInfo.applied_rate_kg_per_week)}
            </p>
          )}
          <p className="mt-1 text-on-surface-variant">{recommendedInfo.cap_explanation}</p>
        </div>
      )}

      <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-low p-4">
        <div className="flex items-center justify-between text-xs text-on-surface-variant">
          <span>Estimated maintenance</span>
          <span data-testid="maintenance-calories" className="font-semibold text-on-surface">
            {recommendedInfo ? `${recommendedInfo.maintenance_calories} kcal/day` : "…"}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-on-surface-variant">
          <span>Suggested intake</span>
          <span data-testid="suggested-intake" className="font-semibold text-on-surface">
            {recommended ? `${recommended} kcal/day` : "…"}
          </span>
        </div>
        {recommendedInfo && recommendedInfo.daily_energy_change_kcal !== 0 && (
          <div className="mt-1 flex items-center justify-between text-xs text-on-surface-variant">
            <span>Daily {recommendedInfo.daily_energy_change_kcal < 0 ? "deficit" : "surplus"}</span>
            <span data-testid="daily-energy-change" className="font-semibold text-on-surface">
              {Math.abs(recommendedInfo.daily_energy_change_kcal)} kcal
            </span>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <label htmlFor="calorie-slider" className="text-sm font-semibold text-on-surface">
            Your daily calorie target
          </label>
          <span data-testid="selected-calories" className="font-display text-lg font-bold text-on-surface">
            {recommended ? (
              <>
                {selectedCalories} <span className="text-xs font-normal">kcal</span>
              </>
            ) : (
              <span className="text-sm font-normal text-on-surface-variant">Calculating…</span>
            )}
          </span>
        </div>
        <input
          id="calorie-slider"
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={10}
          value={selectedCalories}
          disabled={!recommended}
          onChange={(e) => {
            userEditedCaloriesRef.current = true;
            setCalorieOverride(Number(e.target.value));
          }}
          className="mt-2 w-full accent-[var(--color-primary)]"
        />
        <div className="mt-2 flex items-center gap-2">
          <NumericField
            aria-label="Calorie target (kcal)"
            value={selectedCalories}
            min={sliderMin}
            max={sliderMax}
            disabled={!recommended}
            onLiveChange={(n) => {
              userEditedCaloriesRef.current = true;
              setCalorieOverride(n);
            }}
            onCommit={(n) => {
              userEditedCaloriesRef.current = true;
              setCalorieOverride(n);
            }}
            className="input w-28 disabled:opacity-60"
          />
          {recommended && calorieOverride !== null && calorieOverride !== recommended && (
            <button
              type="button"
              onClick={() => {
                userEditedCaloriesRef.current = true;
                setCalorieOverride(null);
              }}
              className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
            >
              Reset to recommended
            </button>
          )}
        </div>
        {recommended && (
          <p className="mt-1 text-xs text-on-surface-variant">
            {selectedCalories === recommended
              ? "Using the recommended target."
              : selectedCalories > recommended
                ? `${selectedCalories - recommended} kcal above recommended.`
                : `${recommended - selectedCalories} kcal below recommended.`}
          </p>
        )}
        {finalLowCalorieWarning && (
          <p className="mt-2 text-xs text-fat">{finalLowCalorieWarning}</p>
        )}
      </div>

      <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-low p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-on-surface">Macros</span>
          <div className="flex gap-1 rounded-full bg-surface-container p-0.5">
            {(["automatic", "custom"] as MacroMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setMacroMode(mode);
                  onMacroModeChange?.(mode);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                  macroMode === mode
                    ? "bg-primary text-on-primary"
                    : "text-on-surface-variant"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {macroMode === "automatic" ? (
          <div className="space-y-2">
            {result &&
              MACRO_META.map(({ key, label, colorVar }) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-on-surface-variant">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorVar }}
                    />
                    {label}
                  </span>
                  <span data-testid={`macro-${key}`} className="font-semibold text-on-surface">
                    {result.targets[key]}g
                  </span>
                </div>
              ))}
            <p className="pt-1 text-xs text-on-surface-variant">
              Derived automatically from your calorie target and goal.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
                Protein (g)
                <input
                  type="number"
                  min={0}
                  aria-label="Custom protein grams"
                  value={customProtein}
                  onChange={(e) => setCustomProtein(e.target.value)}
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
                Carbs (g)
                <input
                  type="number"
                  min={0}
                  aria-label="Custom carbs grams"
                  value={customCarbs}
                  onChange={(e) => setCustomCarbs(e.target.value)}
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
                Fat (g)
                <input
                  type="number"
                  min={0}
                  aria-label="Custom fat grams"
                  value={customFat}
                  onChange={(e) => setCustomFat(e.target.value)}
                  className="input"
                />
              </label>
            </div>
            {impliedCalories !== null && (
              <p
                className={`text-xs ${customOffTarget ? "text-fat" : "text-on-surface-variant"}`}
              >
                These macros total {Math.round(impliedCalories)} kcal
                {customOffTarget
                  ? ` — that's ${Math.round(
                      Math.abs(impliedCalories - selectedCalories),
                    )} kcal ${impliedCalories > selectedCalories ? "over" : "under"} your ${selectedCalories} kcal target. Adjust the macros or your calorie target.`
                  : ` (target: ${selectedCalories} kcal).`}
              </p>
            )}
          </div>
        )}
      </div>

      {loading && <p className="text-xs text-on-surface-variant">Calculating…</p>}
      {error && <p className="text-xs text-fat">{error}</p>}
    </div>
  );
}

/** "Lose 0.7 kg/week" / "Gain 0.25 kg/week" / "Maintain" — the same
 * calm, human phrasing used everywhere else a rate is shown. */
function formatRateLabel(goal: Goal, rateKgPerWeek: number | null): string {
  if (goal === "maintain" || rateKgPerWeek === null) return "Maintain";
  const verb = goal === "cut" ? "Lose" : "Gain";
  const rate = Math.round(rateKgPerWeek * 100) / 100;
  return `${verb} ${rate} kg/week`;
}

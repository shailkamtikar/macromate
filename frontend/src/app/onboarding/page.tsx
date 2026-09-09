"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActivityLevel, BiologicalSex, Goal, MacroMode, MacroTargetsResponse } from "@/lib/api";
import { ActivityLevelPicker } from "@/components/ActivityLevelPicker";
import { NumericField } from "@/components/NumericField";
import { RatePicker } from "@/components/RatePicker";
import { TargetsEditor } from "@/components/TargetsEditor";
import { browserTimezone } from "@/lib/date";
import { supabase } from "@/lib/supabaseClient";
import { useSession } from "@/lib/useSession";

const GOAL_LABELS: Record<Goal, string> = {
  cut: "Cut",
  maintain: "Maintain",
  bulk: "Bulk",
};

const STEP_TITLES = ["Basics", "Activity level", "Goal & pace", "Your targets"];

export default function OnboardingPage() {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();

  const [step, setStep] = useState(0);

  const [username, setUsername] = useState("");
  const [sex, setSex] = useState<BiologicalSex>("male");
  const [ageYears, setAgeYears] = useState(28);
  const [heightCm, setHeightCm] = useState(178);
  const [weightKg, setWeightKg] = useState(75);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("moderate");
  const [goal, setGoal] = useState<Goal>("maintain");
  const [rateKgPerWeek, setRateKgPerWeek] = useState<number | null>(null);

  const [targetsResult, setTargetsResult] = useState<MacroTargetsResponse | null>(null);
  const [macroMode, setMacroMode] = useState<MacroMode>("automatic");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sessionLoading) {
    return <p className="p-10 text-sm text-on-surface-variant">Loading…</p>;
  }

  if (!session) {
    return (
      <main className="flex flex-1 items-center justify-center p-10">
        <p className="text-sm text-on-surface-variant">
          You need to{" "}
          <a href="/login" className="font-semibold text-primary">
            log in
          </a>{" "}
          first.
        </p>
      </main>
    );
  }

  const currentSession = session;

  const canLeaveBasics = username.trim().length > 0 && weightKg > 0 && heightCm > 0 && ageYears > 0;
  const canLeaveGoalStep = goal === "maintain" || rateKgPerWeek !== null;

  function goNext() {
    setError(null);
    setStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
  }
  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    if (!targetsResult) {
      setError("Targets haven't finished calculating yet — wait a moment and try again.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const { error: upsertError } = await supabase.from("profiles").upsert({
        id: currentSession.user.id,
        username,
        sex,
        age_years: ageYears,
        height_cm: heightCm,
        activity_level: activityLevel,
        goal,
        rate_kg_per_week: goal === "maintain" ? null : rateKgPerWeek,
        macro_mode: macroMode,
        target_calories: targetsResult.targets.calories,
        target_protein_g: targetsResult.targets.protein_g,
        target_carbs_g: targetsResult.targets.carbs_g,
        target_fat_g: targetsResult.targets.fat_g,
        water_goal_ml: targetsResult.water_goal_ml,
        timezone: browserTimezone(),
      });
      if (upsertError) throw upsertError;

      const { error: weightLogError } = await supabase
        .from("weight_logs")
        .insert({ user_id: currentSession.user.id, weight_kg: weightKg });
      if (weightLogError) throw weightLogError;

      router.push("/today");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 justify-center px-6 py-10">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
            Set up your profile
          </h1>
          <div className="flex items-center gap-1.5">
            {STEP_TITLES.map((title, i) => (
              <div
                key={title}
                className={`h-1.5 flex-1 rounded-full ${
                  i <= step ? "bg-primary" : "bg-surface-container-high"
                }`}
              />
            ))}
          </div>
          <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}
          </p>
        </header>

        <div className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          {step === 0 && (
            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
                Username
                <input
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
                  Weight (kg)
                  <NumericField
                    min={1}
                    max={400}
                    value={weightKg}
                    onLiveChange={setWeightKg}
                    onCommit={setWeightKg}
                    className="input"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
                  Height (cm)
                  <NumericField
                    min={1}
                    max={280}
                    value={heightCm}
                    onLiveChange={setHeightCm}
                    onCommit={setHeightCm}
                    className="input"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
                  Age
                  <NumericField
                    min={1}
                    max={120}
                    value={ageYears}
                    onLiveChange={setAgeYears}
                    onCommit={setAgeYears}
                    className="input"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
                  Sex
                  <select
                    value={sex}
                    onChange={(e) => setSex(e.target.value as BiologicalSex)}
                    className="input"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-on-surface-variant">
                Pick whichever description sounds closest to what a normal week actually looks
                like for you — not your goal week.
              </p>
              <ActivityLevelPicker value={activityLevel} onChange={setActivityLevel} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex gap-2">
                {(Object.entries(GOAL_LABELS) as [Goal, string][]).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => {
                      setGoal(value);
                      setRateKgPerWeek(null);
                    }}
                    className={`flex-1 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold transition-colors ${
                      goal === value
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <RatePicker goal={goal} value={rateKgPerWeek} onChange={setRateKgPerWeek} />
            </div>
          )}

          {step === 3 && (
            <TargetsEditor
              weightKg={weightKg}
              heightCm={heightCm}
              ageYears={ageYears}
              sex={sex}
              activityLevel={activityLevel}
              goal={goal}
              rateKgPerWeek={rateKgPerWeek}
              onResult={setTargetsResult}
              onMacroModeChange={setMacroMode}
            />
          )}
        </div>

        {error && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="flex-1 rounded-[var(--radius-control)] border border-outline-variant py-3 text-sm font-semibold text-on-surface"
            >
              Back
            </button>
          )}
          {step < STEP_TITLES.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={
                (step === 0 && !canLeaveBasics) || (step === 2 && !canLeaveGoalStep)
              }
              className="flex-1 rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !targetsResult}
              className="flex-1 rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save & continue"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

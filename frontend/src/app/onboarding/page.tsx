"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActivityLevel, BiologicalSex, fetchMacroTargets, Goal } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import { useSession } from "@/lib/useSession";

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  light: "Lightly active",
  moderate: "Moderately active",
  active: "Active",
  very_active: "Very active",
};

const GOAL_LABELS: Record<Goal, string> = {
  cut: "Cut",
  maintain: "Maintain",
  bulk: "Bulk",
};

export default function OnboardingPage() {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();

  const [username, setUsername] = useState("");
  const [sex, setSex] = useState<BiologicalSex>("male");
  const [ageYears, setAgeYears] = useState(28);
  const [heightCm, setHeightCm] = useState(178);
  const [weightKg, setWeightKg] = useState(75);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("moderate");
  const [goal, setGoal] = useState<Goal>("maintain");

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // Business-logic calculation stays server-side (backend), per PRD 4.2.
      const { targets } = await fetchMacroTargets({
        weight_kg: weightKg,
        height_cm: heightCm,
        age_years: ageYears,
        sex,
        activity_level: activityLevel,
        goal,
      });

      // Profile persistence via Supabase directly, RLS-scoped to this user.
      const { error: upsertError } = await supabase.from("profiles").upsert({
        id: session!.user.id,
        username,
        sex,
        age_years: ageYears,
        height_cm: heightCm,
        activity_level: activityLevel,
        goal,
        target_calories: targets.calories,
        target_protein_g: targets.protein_g,
        target_carbs_g: targets.carbs_g,
        target_fat_g: targets.fat_g,
      });

      if (upsertError) {
        throw upsertError;
      }

      // First weight_log entry.
      const { error: weightLogError } = await supabase
        .from("weight_logs")
        .insert({ user_id: session!.user.id, weight_kg: weightKg });
      if (weightLogError) {
        throw weightLogError;
      }

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
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
            Set up your profile
          </h1>
          <p className="text-sm text-on-surface-variant">
            Used to compute your daily calorie and macro targets.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
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
              <input
                type="number"
                min={1}
                step="0.1"
                value={weightKg}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
              Height (cm)
              <input
                type="number"
                min={1}
                step="0.1"
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
              Age
              <input
                type="number"
                min={1}
                value={ageYears}
                onChange={(e) => setAgeYears(Number(e.target.value))}
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
            <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
              Activity level
              <select
                value={activityLevel}
                onChange={(e) => setActivityLevel(e.target.value as ActivityLevel)}
                className="input"
              >
                {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="col-span-2 flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
              Goal
              <div className="flex gap-2">
                {(Object.entries(GOAL_LABELS) as [Goal, string][]).map(
                  ([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setGoal(value)}
                      className={`flex-1 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold transition-colors ${
                        goal === value
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container text-on-surface-variant"
                      }`}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save & continue"}
          </button>
        </form>

        {error && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

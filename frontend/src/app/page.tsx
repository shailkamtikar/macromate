"use client";

import { useState } from "react";
import {
  ActivityLevel,
  ApiError,
  BiologicalSex,
  fetchMacroTargets,
  Goal,
  MacroTargetsResponse,
} from "@/lib/api";

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

const MACRO_ROWS: { key: "protein_g" | "carbs_g" | "fat_g"; label: string; colorVar: string }[] = [
  { key: "protein_g", label: "Protein", colorVar: "var(--color-protein)" },
  { key: "carbs_g", label: "Carbs", colorVar: "var(--color-carbs)" },
  { key: "fat_g", label: "Fat", colorVar: "var(--color-fat)" },
];

export default function Home() {
  const [weightKg, setWeightKg] = useState(75);
  const [heightCm, setHeightCm] = useState(178);
  const [ageYears, setAgeYears] = useState(28);
  const [sex, setSex] = useState<BiologicalSex>("male");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("moderate");
  const [goal, setGoal] = useState<Goal>("maintain");

  const [result, setResult] = useState<MacroTargetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMacroTargets({
        weight_kg: weightKg,
        height_cm: heightCm,
        age_years: ageYears,
        sex,
        activity_level: activityLevel,
        goal,
      });
      setResult(response);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError
          ? `Couldn't reach the MacroMate API. Is the backend running (uv run uvicorn app.main:app --reload in backend/)? ${err.message}`
          : "Something went wrong computing your targets.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 justify-center px-6 py-10">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
            MacroMate
          </h1>
          <p className="text-sm text-on-surface-variant">
            Daily calorie &amp; macro target calculator — real numbers from the
            FastAPI backend&apos;s deterministic BMR/TDEE logic (PRD §3.3,
            §4.2). No fake data: this form calls the live API.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Weight (kg)">
              <input
                type="number"
                min={1}
                step="0.1"
                value={weightKg}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="Height (cm)">
              <input
                type="number"
                min={1}
                step="0.1"
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="Age">
              <input
                type="number"
                min={1}
                value={ageYears}
                onChange={(e) => setAgeYears(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="Sex">
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as BiologicalSex)}
                className="input"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </Field>
            <Field label="Activity level" className="col-span-2">
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
            </Field>
            <Field label="Goal" className="col-span-2">
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
            </Field>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary transition-transform active:scale-[0.985] disabled:opacity-60"
          >
            {loading ? "Calculating…" : "Calculate targets"}
          </button>
        </form>

        {error && (
          <p className="rounded-[var(--radius-control)] border border-fat/30 bg-fat/10 p-3 text-sm text-fat">
            {error}
          </p>
        )}

        {result && (
          <section className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Energy budget
                </p>
                <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
                  {result.targets.calories}{" "}
                  <span className="text-base font-medium text-on-surface-variant">
                    kcal / day
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  BMI
                </p>
                <p className="text-lg font-semibold text-on-surface">
                  {result.bmi}{" "}
                  <span className="text-sm font-normal text-on-surface-variant">
                    ({result.bmi_category})
                  </span>
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {MACRO_ROWS.map(({ key, label, colorVar }) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-on-surface">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorVar }}
                    />
                    {label}
                  </span>
                  <span className="text-on-surface-variant">
                    <strong className="text-on-surface">
                      {result.targets[key]}g
                    </strong>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-on-surface-variant ${className}`}>
      {label}
      {children}
    </label>
  );
}

"use client";

import { useEffect, useState } from "react";
import { WeeklyReport, fetchWeeklyReport } from "@/lib/api";
import { useSession } from "@/lib/useSession";

function ComparisonBar({
  label,
  current,
  previous,
  colorVar,
  unit = "",
}: {
  label: string;
  current: number;
  previous: number;
  colorVar: string;
  unit?: string;
}) {
  const max = Math.max(current, previous, 1);
  const currentPct = (current / max) * 100;
  const previousPct = (previous / max) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-on-surface">{label}</span>
        <span className="text-on-surface-variant">
          {current}
          {unit} <span className="text-on-surface-variant/70">(was {previous}{unit})</span>
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container">
          <div
            className="h-full rounded-full"
            style={{ width: `${currentPct}%`, backgroundColor: colorVar }}
          />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
          <div
            className="h-full rounded-full opacity-40"
            style={{ width: `${previousPct}%`, backgroundColor: colorVar }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProgressPage() {
  const { session, loading: sessionLoading } = useSession();
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetchWeeklyReport()
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load progress."));
  }, [session]);

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

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl space-y-4">
        <header>
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            Progress
          </h1>
          <p className="text-sm text-on-surface-variant">This week vs. last week.</p>
        </header>

        {error && <p className="text-sm text-fat">{error}</p>}

        {!report ? (
          <p className="text-sm text-on-surface-variant">Loading…</p>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Adherence
                </p>
                <p className="font-display text-2xl font-bold text-on-surface">
                  {report.current.adherence_pct}%
                </p>
                <p className="text-xs text-on-surface-variant">
                  {report.current.days_goal_hit}/7 days on target
                </p>
              </div>
              <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Weight trend
                </p>
                <p className="font-display text-2xl font-bold text-on-surface">
                  {report.weight_delta_kg === null
                    ? "—"
                    : `${report.weight_delta_kg > 0 ? "+" : ""}${report.weight_delta_kg}kg`}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {report.weight_start_kg && report.weight_end_kg
                    ? `${report.weight_start_kg}kg → ${report.weight_end_kg}kg`
                    : "No weigh-ins this week"}
                </p>
              </div>
            </section>

            {report.wins.length > 0 && (
              <section className="rounded-[var(--radius-card)] border border-primary/25 bg-surface-container-lowest p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-1.5 text-primary">
                  <span className="material-symbols-outlined text-lg">celebration</span>
                  <span className="text-xs font-bold uppercase tracking-wider">Wins</span>
                </div>
                <ul className="space-y-1">
                  {report.wins.map((w, i) => (
                    <li key={i} className="text-sm text-on-surface">
                      {w}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-3 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Daily averages — solid = this week, faded = last week
              </p>
              <ComparisonBar
                label="Calories"
                current={report.current.avg_calories}
                previous={report.previous.avg_calories}
                colorVar="var(--color-primary)"
                unit=" kcal"
              />
              <ComparisonBar
                label="Protein"
                current={report.current.avg_protein_g}
                previous={report.previous.avg_protein_g}
                colorVar="var(--color-protein)"
                unit="g"
              />
              <ComparisonBar
                label="Carbs"
                current={report.current.avg_carbs_g}
                previous={report.previous.avg_carbs_g}
                colorVar="var(--color-carbs)"
                unit="g"
              />
              <ComparisonBar
                label="Fat"
                current={report.current.avg_fat_g}
                previous={report.previous.avg_fat_g}
                colorVar="var(--color-fat)"
                unit="g"
              />
            </section>
          </>
        )}
      </div>
    </main>
  );
}

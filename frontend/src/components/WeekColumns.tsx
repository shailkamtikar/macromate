"use client";

import { m } from "motion/react";
import { DaySummary } from "@/lib/api";
import { describeDay } from "@/components/dayDisplay";
import { ease } from "@/components/ui/motion";

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

const SERIES = [
  { key: "kcal", label: "Kcal", color: "var(--color-primary)", x: 20 },
  { key: "protein", label: "Protein", color: "var(--color-protein)", x: 40 },
  { key: "carbs", label: "Carbs", color: "var(--color-carbs)", x: 60 },
  { key: "fat", label: "Fat", color: "var(--color-fat)", x: 80 },
] as const;

/** Where a day's total sits relative to its target, as a 0..1 height inside
 * the column: 1.0x the target lands in the shaded "on target" band, 1.5x or
 * more at the very top, nothing eaten at the bottom. */
function heightFor(consumed: number, target: number | null): number | null {
  if (!target || target <= 0) return null;
  return Math.min(Math.max(consumed / target / 1.5, 0.04), 0.96);
}

function dotsFor(s: DaySummary) {
  return [
    heightFor(s.calories, s.target_calories),
    heightFor(s.protein_g, s.target_protein_g),
    heightFor(s.carbs_g, s.target_carbs_g),
    heightFor(s.fat_g, s.target_fat_g),
  ];
}

/** The seven day columns of the week overview (one dot per measure, placed by
 * how it compared with the target) plus its legend. Purely presentational:
 * the dashboard feeds it real summaries, the landing page feeds it sample
 * ones. */
export function WeekColumns({
  days,
  byDate,
  selected,
  today,
  onSelect,
  layoutId = "week-selected",
}: {
  days: string[];
  byDate: Map<string, DaySummary>;
  selected: string;
  today: string;
  onSelect: (iso: string) => void;
  layoutId?: string;
}) {
  return (
    <>
      <div className="mt-3 grid grid-cols-7 gap-1.5" role="group" aria-label="Week">
        {days.map((iso, i) => {
          const summary = byDate.get(iso);
          const isFuture = iso > today;
          const isSelected = iso === selected;
          const dots = summary?.logged ? dotsFor(summary) : [];
          return (
            <button
              key={iso}
              type="button"
              disabled={isFuture}
              onClick={() => onSelect(iso)}
              aria-label={describeDay(iso, summary)}
              aria-pressed={isSelected}
              data-testid={`day-${iso}`}
              className="relative flex flex-col items-center gap-1.5 rounded-[var(--radius-control)] px-0.5 pb-2 pt-1.5 disabled:opacity-30"
            >
              {isSelected && (
                <m.span
                  layoutId={layoutId}
                  className="absolute inset-0 rounded-[var(--radius-control)] border border-primary/60 bg-primary/10"
                  transition={{ duration: 0.3, ease: ease.out }}
                />
              )}
              <span className="relative font-mono text-[10px] font-medium uppercase text-on-surface-variant">
                {WEEKDAY_LETTERS[i]}
              </span>
              <span className="relative h-16 w-full overflow-hidden rounded-md bg-surface-container-low">
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bg-primary/10"
                  style={{ bottom: "60%", height: "13.4%" }}
                />
                {dots.map((h, k) =>
                  h === null ? null : (
                    <m.span
                      key={SERIES[k].key}
                      aria-hidden="true"
                      className="absolute h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full"
                      style={{ left: `${SERIES[k].x}%`, bottom: `${h * 100}%`, backgroundColor: SERIES[k].color }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.3, ease: ease.out, delay: 0.04 * k + 0.02 * i }}
                    />
                  ),
                )}
              </span>
              <span
                className={`relative text-sm font-semibold ${
                  isSelected ? "text-primary" : iso === today ? "text-on-surface" : "text-on-surface-variant"
                }`}
              >
                {Number(iso.slice(8))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-on-surface-variant">
          <span className="h-2.5 w-4 rounded-sm bg-primary/20" /> On target
        </span>
      </div>
    </>
  );
}

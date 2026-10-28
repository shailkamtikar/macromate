"use client";

import { useQuery } from "@tanstack/react-query";
import { m } from "motion/react";
import { useState } from "react";
import { DaySummary, fetchDaysSummary } from "@/lib/api";
import { addDays, parseIso, startOfWeekIso, weekDays } from "@/lib/date";
import { Icon } from "@/components/Icon";
import { MonthCalendar } from "@/components/MonthCalendar";
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

/** The week at a glance: for every day, one dot per measure (kcal, protein,
 * carbs, fat) positioned by how it compared with the target -- the shaded
 * band is "on target", above it is over, below it is under. Selecting a day
 * changes which day the whole dashboard shows; future days are not
 * selectable. The calendar button opens the month view. */
export function DateStrip({
  selected,
  today,
  onSelect,
}: {
  selected: string;
  today: string;
  onSelect: (iso: string) => void;
}) {
  const [monthOpen, setMonthOpen] = useState(false);
  const days = weekDays(selected);
  const weekStart = startOfWeekIso(selected);
  const weekEnd = addDays(weekStart, 6);
  const rangeEnd = weekEnd > today ? today : weekEnd;

  const summaryQuery = useQuery({
    queryKey: ["days-summary", weekStart, rangeEnd],
    queryFn: () => fetchDaysSummary(weekStart, rangeEnd),
  });
  const byDate = new Map((summaryQuery.data ?? []).map((d) => [d.date, d]));

  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);
  const canGoNext = nextWeek <= today;
  const rangeLabel = `${parseIso(weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${parseIso(weekEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  return (
    <div className="card relative p-4" data-testid="date-strip">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="eyebrow whitespace-nowrap">Week overview</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSelect(prevWeek)}
            aria-label="Previous week"
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <Icon name="chevron_left" className="text-xl" />
          </button>
          <button
            type="button"
            onClick={() => setMonthOpen((v) => !v)}
            aria-expanded={monthOpen}
            aria-haspopup="dialog"
            data-testid="open-month-calendar"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface sm:px-3"
          >
            <Icon name="calendar_month" className="text-sm max-sm:hidden" />
            {rangeLabel}
          </button>
          <button
            type="button"
            onClick={() => onSelect(canGoNext ? nextWeek : today)}
            disabled={!canGoNext}
            aria-label="Next week"
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-30"
          >
            <Icon name="chevron_right" className="text-xl" />
          </button>
        </div>
      </div>

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
                  layoutId="week-selected"
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

      {monthOpen && (
        <MonthCalendar
          selected={selected}
          today={today}
          onSelect={(iso) => {
            setMonthOpen(false);
            onSelect(iso);
          }}
          onClose={() => setMonthOpen(false)}
        />
      )}
    </div>
  );
}

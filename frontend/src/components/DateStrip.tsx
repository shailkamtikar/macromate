"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchDaysSummary } from "@/lib/api";
import { addDays, parseIso, startOfWeekIso, weekDays } from "@/lib/date";
import { MonthCalendar } from "@/components/MonthCalendar";
import { describeDay, statusDotClass } from "@/components/dayDisplay";

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** A week at a glance with a dot per day (logged / on target / over / under)
 * and a button that opens the month calendar. Selecting a day changes which
 * day the whole dashboard shows. Future days are not selectable. */
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

  return (
    <div className="relative" data-testid="date-strip">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelect(prevWeek)}
          aria-label="Previous week"
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">
            chevron_left
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMonthOpen((v) => !v)}
          aria-expanded={monthOpen}
          aria-haspopup="dialog"
          data-testid="open-month-calendar"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            calendar_month
          </span>
          {parseIso(weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
          {parseIso(weekEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </button>
        <button
          type="button"
          onClick={() => onSelect(canGoNext ? nextWeek : today)}
          disabled={!canGoNext}
          aria-label="Next week"
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">
            chevron_right
          </span>
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="Week">
        {days.map((iso, i) => {
          const summary = byDate.get(iso);
          const isFuture = iso > today;
          const isSelected = iso === selected;
          return (
            <button
              key={iso}
              type="button"
              disabled={isFuture}
              onClick={() => onSelect(iso)}
              aria-label={describeDay(iso, summary)}
              aria-pressed={isSelected}
              data-testid={`day-${iso}`}
              className={`flex flex-col items-center gap-1 rounded-[var(--radius-control)] py-2 text-xs transition-colors disabled:opacity-30 ${
                isSelected
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-low text-on-surface hover:bg-surface-container"
              } ${iso === today && !isSelected ? "ring-1 ring-primary" : ""}`}
            >
              <span className={isSelected ? "opacity-80" : "text-on-surface-variant"}>
                {WEEKDAY_LETTERS[i]}
              </span>
              <span className="text-sm font-semibold">{Number(iso.slice(8))}</span>
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  isSelected && summary?.logged
                    ? "bg-on-primary"
                    : statusDotClass(summary?.status.calories, !!summary?.logged)
                }`}
              />
            </button>
          );
        })}
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

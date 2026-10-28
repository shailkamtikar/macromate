"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchDaysSummary } from "@/lib/api";
import { addDays, parseIso, startOfWeekIso, weekDays } from "@/lib/date";
import { Icon } from "@/components/Icon";
import { MonthCalendar } from "@/components/MonthCalendar";
import { WeekColumns } from "@/components/WeekColumns";

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

      <WeekColumns days={days} byDate={byDate} selected={selected} today={today} onSelect={onSelect} />

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

"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchDaysSummary } from "@/lib/api";
import {
  addDays,
  addMonths,
  formatMonthYear,
  monthEndIso,
  monthGrid,
  monthStartIso,
} from "@/lib/date";
import { describeDay, statusDotClass } from "@/components/dayDisplay";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month grid (Monday first) with a status dot per logged day. Keyboard:
 * arrow keys move between days, Enter/Space selects, Escape closes. Future
 * days are disabled. */
export function MonthCalendar({
  selected,
  today,
  onSelect,
  onClose,
}: {
  selected: string;
  today: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(monthStartIso(selected));
  const [focused, setFocused] = useState(selected);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const start = monthStartIso(month);
  const end = monthEndIso(month) > today ? today : monthEndIso(month);
  const summaryQuery = useQuery({
    queryKey: ["days-summary", start, end],
    queryFn: () => fetchDaysSummary(start, end),
    enabled: start <= today,
  });
  const byDate = new Map((summaryQuery.data ?? []).map((d) => [d.date, d]));
  const cells = monthGrid(month);
  const canGoNext = addMonths(month, 1) <= today;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focused}"]`)?.focus();
  }, [focused, month]);

  function moveFocus(delta: number) {
    const next = addDays(focused, delta);
    if (next > today) return;
    setFocused(next);
    if (monthStartIso(next) !== month) setMonth(monthStartIso(next));
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in deltas) {
      e.preventDefault();
      moveFocus(deltas[e.key]);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Choose a date"
        data-testid="month-calendar"
        className="absolute left-0 right-0 top-full z-40 mt-2 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-lg"
      >
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              chevron_left
            </span>
          </button>
          <p className="text-sm font-semibold text-on-surface" aria-live="polite">
            {formatMonthYear(month)}
          </p>
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, 1))}
            disabled={!canGoNext}
            aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              chevron_right
            </span>
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wider text-on-surface-variant">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div
          ref={gridRef}
          onKeyDown={onGridKeyDown}
          className="mt-1 grid grid-cols-7 gap-1"
          role="grid"
          aria-label={formatMonthYear(month)}
        >
          {cells.map((iso) => {
            const inMonth = iso.slice(0, 7) === month.slice(0, 7);
            const isFuture = iso > today;
            const summary = byDate.get(iso);
            const isSelected = iso === selected;
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                data-iso={iso}
                data-testid={`month-day-${iso}`}
                disabled={isFuture}
                tabIndex={iso === focused ? 0 : -1}
                aria-label={describeDay(iso, summary)}
                aria-selected={isSelected}
                onClick={() => onSelect(iso)}
                className={`flex h-10 flex-col items-center justify-center rounded-[var(--radius-control)] text-sm transition-colors disabled:opacity-25 ${
                  isSelected
                    ? "bg-primary font-semibold text-on-primary"
                    : "text-on-surface hover:bg-surface-container"
                } ${!inMonth ? "opacity-40" : ""} ${
                  iso === today && !isSelected ? "ring-1 ring-primary" : ""
                }`}
              >
                <span>{Number(iso.slice(8))}</span>
                <span
                  aria-hidden="true"
                  className={`mt-0.5 h-1 w-1 rounded-full ${
                    isSelected && summary?.logged
                      ? "bg-on-primary"
                      : statusDotClass(summary?.status.calories, !!summary?.logged)
                  }`}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <p className="flex items-center gap-3 text-[11px] text-on-surface-variant">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> On target
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-carbs" /> Under
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-fat" /> Over
            </span>
          </p>
          <button
            type="button"
            onClick={() => onSelect(today)}
            className="text-xs font-semibold text-primary"
          >
            Today
          </button>
        </div>
      </div>
    </>
  );
}

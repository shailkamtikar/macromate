"use client";

import { useEffect, useState } from "react";
import { Achievements } from "@/lib/api";

const MILESTONES = [3, 7, 14, 30];
const SEEN_MILESTONES_KEY = "macromate:seen-milestones";

function readSeenMilestones(): number[] {
  try {
    const raw = localStorage.getItem(SEEN_MILESTONES_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function writeSeenMilestones(milestones: number[]): void {
  try {
    localStorage.setItem(SEEN_MILESTONES_KEY, JSON.stringify(milestones));
  } catch {
    // Best-effort only -- a private/blocked storage context just means the
    // next visit re-plays the reveal animation, nothing breaks.
  }
}

const MACRO_LABELS: { key: "calories" | "protein" | "carbs" | "fat"; label: string }[] = [
  { key: "calories", label: "Calories" },
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
];

/** A compact "current streak" indicator for Today -- no badges, no macro
 * breakdown, just the one number that matters while logging. */
export function StreakChip({ achievements }: { achievements: Achievements }) {
  if (achievements.current_streak_days <= 0) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
      <span className="material-symbols-outlined text-sm" aria-hidden="true">
        local_fire_department
      </span>
      {achievements.current_streak_days}-day streak
    </div>
  );
}

/** The full achievements card for Progress: streak + milestone badges (with
 * a one-time subtle reveal the first time a new milestone is seen on this
 * device), today's macro-target hits, and a weight-progress line when the
 * data supports one. Never shames -- every line here is either neutral
 * (streak/badges) or a genuine positive; nothing is shown for a missed
 * goal. */
export function AchievementsCard({ achievements }: { achievements: Achievements }) {
  const [newlyHit, setNewlyHit] = useState<Set<number>>(new Set());

  useEffect(() => {
    const seen = readSeenMilestones();
    const fresh = achievements.milestones_hit.filter((m) => !seen.includes(m));
    if (fresh.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a client-only API (localStorage) to derive "new since last visit", not reachable during render
      setNewlyHit(new Set(fresh));
      writeSeenMilestones(Array.from(new Set([...seen, ...achievements.milestones_hit])));
    }
    // Only ever compute this once per mount -- a milestone is "new" only
    // relative to what this device had already recorded seeing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hitMacros = MACRO_LABELS.filter((m) => achievements.macro_goals_hit_today[m.key]);

  return (
    <section className="reveal-in rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            Logging streak
          </p>
          <p className="font-display text-2xl font-bold text-on-surface">
            {achievements.current_streak_days}{" "}
            <span className="text-base font-medium text-on-surface-variant">days</span>
          </p>
        </div>
        <div className="flex gap-1">
          {MILESTONES.map((m) => {
            const hit = achievements.milestones_hit.includes(m);
            return (
              <span
                key={m}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${
                  hit ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
                } ${hit && newlyHit.has(m) ? "reveal-in" : ""}`}
                title={`${m}-day streak`}
              >
                {m}
              </span>
            );
          })}
        </div>
      </div>

      {hitMacros.length > 0 && (
        <p className="mt-2 text-xs text-on-surface-variant">
          On target today:{" "}
          <span className="font-medium text-on-surface">
            {hitMacros.map((m) => m.label).join(", ")}
          </span>
        </p>
      )}

      {achievements.weight_lower_than_last && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-primary">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            trending_down
          </span>
          Weight down {Math.abs(achievements.weight_delta_kg ?? 0)}kg since last entry.
        </p>
      )}
    </section>
  );
}

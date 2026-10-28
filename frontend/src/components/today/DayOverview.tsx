"use client";

import { m } from "motion/react";
import { DayStatus } from "@/lib/api";
import { MacroBar, NumberTicker, Reveal, Ring, ease } from "@/components/ui/motion";

export interface Totals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface TargetSet {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

const MACROS = [
  { key: "protein_g", label: "Protein", short: "P", color: "var(--color-protein)" },
  { key: "carbs_g", label: "Carbs", short: "C", color: "var(--color-carbs)" },
  { key: "fat_g", label: "Fat", short: "F", color: "var(--color-fat)" },
] as const;

/** Same +/-10% band the backend uses for "on target". */
export function statusFor(consumed: number, target: number | null | undefined): DayStatus {
  if (!target || target <= 0 || consumed <= 0) return "none";
  const ratio = consumed / target;
  if (ratio < 0.9) return "low";
  if (ratio > 1.1) return "high";
  return "ok";
}

/** The dashboard hero: a large animated "kcal left", a progress bar, and one
 * ring per macro. Everything here is derived from numbers the page already
 * has -- no extra requests. */
export function EnergyHero({
  consumed,
  targets,
  isToday,
}: {
  consumed: Totals;
  targets: TargetSet;
  isToday: boolean;
}) {
  const remaining = Math.max(targets.calories - consumed.calories, 0);
  const over = Math.max(consumed.calories - targets.calories, 0);
  const pct = targets.calories > 0 ? Math.round((consumed.calories / targets.calories) * 100) : 0;

  return (
    <section className="card card-glow relative overflow-hidden p-6">
      <div
        aria-hidden="true"
        className="drift pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{isToday ? "Energy budget" : "Energy that day"}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-6xl font-extrabold leading-none tracking-tight text-on-surface">
              <NumberTicker value={over > 0 ? over : remaining} />
            </span>
            <span className="text-base font-medium text-on-surface-variant">
              {over > 0 ? "kcal over" : "kcal left"}
            </span>
          </div>
        </div>
        <Ring value={consumed.calories} max={targets.calories} size={84} stroke={8} label={`${pct}% of the daily calorie goal`}>
          <span className="tabular text-sm font-bold text-on-surface">{Math.min(pct, 999)}%</span>
        </Ring>
      </div>

      <div className="relative mt-5">
        <MacroBar value={consumed.calories} max={targets.calories} color="var(--color-primary)" height={12} />
        <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            Consumed{" "}
            <strong className="font-semibold text-on-surface" data-testid="consumed-calories">
              <NumberTicker value={Math.round(consumed.calories)} format={(n) => String(Math.round(n))} /> kcal
            </strong>
          </span>
          <span>
            Daily goal <strong className="font-semibold text-on-surface">{targets.calories} kcal</strong>
          </span>
        </div>
      </div>

      <div className="relative mt-6 grid grid-cols-3 gap-3">
        {MACROS.map((macro, i) => {
          const target = targets[macro.key] ?? 0;
          const value = consumed[macro.key];
          return (
            <Reveal key={macro.key} index={i + 1} className="flex flex-col items-center gap-2 rounded-[var(--radius-control)] bg-surface-container-low px-2 py-3">
              <Ring
                value={value}
                max={target}
                size={60}
                stroke={6}
                color={macro.color}
                label={`${macro.label}: ${Math.round(value)} of ${target} grams`}
              >
                <span className="tabular text-xs font-bold text-on-surface">
                  <NumberTicker value={Math.round(value)} />
                </span>
              </Ring>
              <div className="text-center">
                <p className="text-xs font-semibold text-on-surface">{macro.label}</p>
                <p className="tabular text-[11px] text-on-surface-variant">
                  {Math.round(value)} / {target} g
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

const CHIP: Record<Exclude<DayStatus, "none">, { label: string; className: string }> = {
  ok: { label: "On target", className: "bg-primary/15 text-primary" },
  low: { label: "Below target", className: "bg-carbs/15 text-carbs" },
  high: { label: "Over target", className: "bg-fat/15 text-fat" },
};

function leftText(value: number, target: number, unit: string) {
  const diff = Math.round(target - value);
  if (diff > 0) return `${diff} ${unit} to go`;
  if (diff === 0) return "Goal reached";
  return `${Math.abs(diff)} ${unit} over`;
}

/** Four compact cards with a plain-language status for each macro and
 * hydration -- the "am I on track?" glance, computed from today's totals. */
export function InsightCards({
  consumed,
  targets,
  waterMl,
  waterGoalMl,
}: {
  consumed: Totals;
  targets: TargetSet;
  waterMl: number;
  waterGoalMl: number;
}) {
  const cards = [
    {
      key: "protein",
      title: "Protein",
      color: "var(--color-protein)",
      status: statusFor(consumed.protein_g, targets.protein_g),
      text: leftText(consumed.protein_g, targets.protein_g ?? 0, "g"),
    },
    {
      key: "carbs",
      title: "Carbs",
      color: "var(--color-carbs)",
      status: statusFor(consumed.carbs_g, targets.carbs_g),
      text: leftText(consumed.carbs_g, targets.carbs_g ?? 0, "g"),
    },
    {
      key: "fat",
      title: "Fat",
      color: "var(--color-fat)",
      status: statusFor(consumed.fat_g, targets.fat_g),
      text: leftText(consumed.fat_g, targets.fat_g ?? 0, "g"),
    },
    {
      key: "water",
      title: "Hydration",
      color: "var(--color-water)",
      status: statusFor(waterMl, waterGoalMl),
      text: leftText(waterMl, waterGoalMl, "ml"),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="insights">
      {cards.map((card, i) => {
        const chip = card.status === "none" ? null : CHIP[card.status];
        return (
          <m.div
            key={card.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: ease.out, delay: 0.05 * i }}
            whileHover={{ y: -2 }}
            className="card flex flex-col gap-2 p-4"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: card.color }} />
              <p className="text-xs font-semibold text-on-surface">{card.title}</p>
            </div>
            <p className="tabular text-sm text-on-surface-variant">{card.text}</p>
            {chip ? (
              <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}>
                {chip.label}
              </span>
            ) : (
              <span className="w-fit rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
                Nothing yet
              </span>
            )}
          </m.div>
        );
      })}
    </div>
  );
}

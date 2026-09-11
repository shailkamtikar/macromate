"use client";

import { Goal } from "@/lib/api";

interface RatePickerProps {
  goal: Goal;
  value: number | null;
  onChange: (rate: number) => void;
}

const CUT_OPTIONS: { rate: number; label: string; blurb: string }[] = [
  { rate: 0.5, label: "0.5 kg/week", blurb: "Gradual — easiest to sustain, smallest calorie deficit." },
  { rate: 0.75, label: "0.75 kg/week", blurb: "Moderate — a balance of speed and sustainability." },
  { rate: 1.0, label: "1 kg/week", blurb: "Aggressive — the fastest rate we offer; a larger daily deficit." },
];

const BULK_OPTIONS: { rate: number; label: string; blurb: string }[] = [
  { rate: 0.25, label: "0.25 kg/week", blurb: "Lean bulk — a modest surplus to limit fat gain while building muscle." },
];

// Weight-loss/gain rate is asked explicitly (not folded into "goal") so the
// calorie deficit/surplus it implies is deliberate, not a hidden default.
export function RatePicker({ goal, value, onChange }: RatePickerProps) {
  if (goal === "maintain") {
    return (
      <p className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-3 text-xs text-on-surface-variant">
        Maintaining weight — your target will match your calculated maintenance calories, no
        deficit or surplus.
      </p>
    );
  }

  const options = goal === "cut" ? CUT_OPTIONS : BULK_OPTIONS;

  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = value === opt.rate;
        return (
          <button
            key={opt.rate}
            type="button"
            onClick={() => onChange(opt.rate)}
            aria-pressed={selected}
            className={`w-full rounded-[var(--radius-card)] border p-3 text-left transition-colors ${
              selected
                ? "border-primary bg-primary-container/30"
                : "border-outline-variant bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-on-surface">
                {goal === "cut" ? "Lose" : "Gain"} {opt.label}
              </span>
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                  selected ? "border-primary bg-primary" : "border-outline-variant"
                }`}
              >
                {selected && (
                  <span className="material-symbols-outlined text-xs text-on-primary" aria-hidden="true">check</span>
                )}
              </span>
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">{opt.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}

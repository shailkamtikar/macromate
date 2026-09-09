"use client";

import { ActivityLevel } from "@/lib/api";
import { ACTIVITY_LEVEL_INFO, ACTIVITY_LEVEL_ORDER } from "@/lib/activityLevels";

interface ActivityLevelPickerProps {
  value: ActivityLevel;
  onChange: (level: ActivityLevel) => void;
}

// A dedicated explanation-then-selection UI: every level's plain-language
// description and a realistic example are always visible, so the user
// understands what a "normal week" looks like for each option before
// picking one — not a bare <select> of jargon.
export function ActivityLevelPicker({ value, onChange }: ActivityLevelPickerProps) {
  return (
    <div className="space-y-2">
      {ACTIVITY_LEVEL_ORDER.map((level) => {
        const info = ACTIVITY_LEVEL_INFO[level];
        const selected = value === level;
        return (
          <button
            key={level}
            type="button"
            onClick={() => onChange(level)}
            aria-pressed={selected}
            className={`w-full rounded-[var(--radius-card)] border p-3 text-left transition-colors ${
              selected
                ? "border-primary bg-primary-container/30"
                : "border-outline-variant bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-on-surface">{info.label}</span>
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                  selected ? "border-primary bg-primary" : "border-outline-variant"
                }`}
              >
                {selected && (
                  <span className="material-symbols-outlined text-xs text-on-primary">check</span>
                )}
              </span>
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">{info.description}</p>
            <p className="mt-1 text-xs italic text-on-surface-variant">{info.example}</p>
          </button>
        );
      })}
    </div>
  );
}

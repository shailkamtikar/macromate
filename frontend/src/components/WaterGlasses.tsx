"use client";

import { useId } from "react";

interface GlassProps {
  fraction: number; // 0..1, how full this one glass is
  action?: "add" | "remove";
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}

function Glass({ fraction, action, actionLabel, onAction, disabled }: GlassProps) {
  const clipId = useId();
  const clamped = Math.max(0, Math.min(1, fraction));
  const cupTop = 4;
  const cupBottom = 36;
  const fillHeight = (cupBottom - cupTop) * clamped;
  const fillY = cupBottom - fillHeight;

  return (
    <div className="relative flex-shrink-0 pb-2">
      <svg viewBox="0 0 28 40" className="h-10 w-7" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d="M2 4 L26 4 L20 36 L8 36 Z" />
          </clipPath>
        </defs>
        {clamped > 0 && (
          <rect
            x="0"
            y={fillY}
            width="28"
            height={fillHeight}
            clipPath={`url(#${clipId})`}
            fill="var(--color-water)"
          />
        )}
        <path
          d="M2 4 L26 4 L20 36 L8 36 Z"
          fill="none"
          stroke="var(--color-outline-variant)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {action && (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          aria-label={actionLabel}
          className={`absolute -bottom-1 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full text-xs font-bold leading-none shadow-sm ring-1 ring-surface transition-opacity disabled:opacity-40 ${
            action === "add"
              ? "bg-primary text-on-primary"
              : "border border-outline-variant bg-surface-container-highest text-on-surface-variant"
          }`}
        >
          {action === "add" ? "+" : "−"}
        </button>
      )}
    </div>
  );
}

interface WaterGlassesProps {
  totalMl: number;
  unitMl: number;
  goalMl: number;
  /** Adds exactly one `unitMl` container. Omit to render a read-only row. */
  onAdd?: () => void;
  /** Removes exactly one `unitMl` container from the most recently logged
   * entry (or partially reduces it) — the undo control. */
  onRemove?: () => void;
  disabled?: boolean;
}

/** Visualizes hydration as a row of glasses sized to the user's own
 * configured glass/container volume — each glass fills from the bottom,
 * fully or partially, rather than a single generic progress bar. The next
 * empty glass carries a "+" (log one more) and the most recently filled
 * glass carries a "−" (undo it) so a correction never requires leaving
 * this view. */
export function WaterGlasses({
  totalMl,
  unitMl,
  goalMl,
  onAdd,
  onRemove,
  disabled,
}: WaterGlassesProps) {
  const unit = unitMl > 0 ? unitMl : 250;
  const glassesForGoal = Math.max(1, Math.round(goalMl / unit));
  const glassesConsumed = Math.ceil(totalMl / unit);
  // +1 so there's always a visible next-empty glass to log into, even once
  // the day has already reached or passed the goal.
  const glassCount = Math.min(Math.max(glassesForGoal, glassesConsumed + 1), 24);

  const fractions = Array.from({ length: glassCount }, (_, i) => {
    const remainingForThisGlass = totalMl - i * unit;
    return Math.max(0, Math.min(1, remainingForThisGlass / unit));
  });

  // The most recently filled (or partially filled) glass is the one "−"
  // corrects — it's simply the last glass with any fill in it, since
  // glasses are always filled in order from the left.
  const lastFilledIndex = totalMl > 0 ? glassesConsumed - 1 : -1;
  const nextEmptyIndex = fractions.findIndex((f) => f <= 0);

  return (
    <div className="flex flex-wrap gap-2" data-testid="water-glasses">
      {fractions.map((fraction, i) => {
        if (i === lastFilledIndex && onRemove) {
          return (
            <Glass
              key={i}
              fraction={fraction}
              action="remove"
              actionLabel={`Remove one ${unit}ml glass`}
              onAction={onRemove}
              disabled={disabled}
            />
          );
        }
        if (i === nextEmptyIndex && onAdd) {
          return (
            <Glass
              key={i}
              fraction={fraction}
              action="add"
              actionLabel={`Add one ${unit}ml glass`}
              onAction={onAdd}
              disabled={disabled}
            />
          );
        }
        return <Glass key={i} fraction={fraction} />;
      })}
    </div>
  );
}

"use client";

import { useId } from "react";

interface GlassProps {
  fraction: number; // 0..1, how full this one glass is
}

function Glass({ fraction }: GlassProps) {
  const clipId = useId();
  const clamped = Math.max(0, Math.min(1, fraction));
  const cupTop = 4;
  const cupBottom = 36;
  const fillHeight = (cupBottom - cupTop) * clamped;
  const fillY = cupBottom - fillHeight;

  return (
    <svg viewBox="0 0 28 40" className="h-10 w-7 flex-shrink-0" aria-hidden="true">
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
  );
}

interface WaterGlassesProps {
  totalMl: number;
  unitMl: number;
  goalMl: number;
}

/** Visualizes hydration as a row of glasses sized to the user's own
 * configured glass/container volume — each glass fills from the bottom,
 * fully or partially, rather than a single generic progress bar. */
export function WaterGlasses({ totalMl, unitMl, goalMl }: WaterGlassesProps) {
  const unit = unitMl > 0 ? unitMl : 250;
  const glassesForGoal = Math.max(1, Math.round(goalMl / unit));
  const glassesConsumed = Math.ceil(totalMl / unit);
  const glassCount = Math.min(Math.max(glassesForGoal, glassesConsumed), 24);

  const fractions = Array.from({ length: glassCount }, (_, i) => {
    const remainingForThisGlass = totalMl - i * unit;
    return Math.max(0, Math.min(1, remainingForThisGlass / unit));
  });

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="water-glasses">
      {fractions.map((fraction, i) => (
        <Glass key={i} fraction={fraction} />
      ))}
    </div>
  );
}

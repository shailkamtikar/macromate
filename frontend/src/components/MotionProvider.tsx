"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

/** App-wide motion setup.
 *
 * - LazyMotion + domAnimation: components use the tiny `m.*` primitives and
 *   the animation engine loads once, keeping the JavaScript on every page
 *   small (the full `motion.*` components would add far more).
 * - MotionConfig reducedMotion="user": anyone whose OS asks for reduced
 *   motion gets instant state changes instead of movement -- transform
 *   animations are disabled, opacity/colour changes stay.
 * Animate only transform and opacity: they are GPU-composited and never
 * trigger layout, which is what keeps interactions at 60 fps. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 380, damping: 32 }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

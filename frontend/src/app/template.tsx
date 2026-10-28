"use client";

import { m } from "motion/react";
import { ease } from "@/components/ui/motion";

/** Re-mounted on every navigation (unlike layout.tsx): a short fade-and-lift
 * makes route changes feel continuous. It never waits on data -- pages show
 * skeletons while their content loads -- and only transform/opacity animate.
 * Reduced-motion users get no movement (see MotionProvider). */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <m.div
      className="flex min-w-0 flex-1 flex-col"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ease.out }}
    >
      {children}
    </m.div>
  );
}

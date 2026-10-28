"use client";

import Link from "next/link";
import { m } from "motion/react";
import { Ring, ease } from "@/components/ui/motion";

/** Two-panel layout for login/signup: on large screens a brand panel with
 * live-looking rings on the left, the form on the right; on phones just the
 * form. Both panels animate in; reduced-motion users get them instantly. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1">
      <aside className="relative hidden flex-1 overflow-hidden border-r border-outline-variant lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0" />
        <div
          aria-hidden="true"
          className="drift pointer-events-none absolute -left-20 top-1/3 h-96 w-96 rounded-full bg-primary/20 blur-3xl"
        />
        <Link href="/" className="eyebrow relative w-fit transition-colors hover:text-on-surface">
          ← Back to home
        </Link>

        <div className="relative">
          <m.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: ease.out }}
            className="font-serif text-6xl leading-[1.02] tracking-tight text-on-surface"
          >
            Small habits,
            <br />
            <em className="text-primary">steady</em> results.
          </m.p>
          <m.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: ease.out, delay: 0.2 }}
            className="mt-10 flex gap-5"
          >
            <Ring value={78} max={100} size={92} stroke={8} color="var(--color-protein)">
              <span className="text-sm font-bold text-on-surface">78%</span>
            </Ring>
            <Ring value={92} max={100} size={92} stroke={8} color="var(--color-primary)">
              <span className="text-sm font-bold text-on-surface">92%</span>
            </Ring>
            <Ring value={64} max={100} size={92} stroke={8} color="var(--color-carbs)">
              <span className="text-sm font-bold text-on-surface">64%</span>
            </Ring>
          </m.div>
        </div>

        <p className="eyebrow relative">Macros · Water · Streaks · Coach</p>
      </aside>

      <section className="flex flex-1 items-center justify-center px-6 py-10">
        <m.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: ease.out }}
          className="w-full max-w-sm space-y-6"
        >
          {children}
        </m.div>
      </section>
    </main>
  );
}

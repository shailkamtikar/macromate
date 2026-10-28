"use client";

import { animate, m, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

/** Shared easing/spring vocabulary so every animation in the app feels like
 * it belongs to the same product: quick, soft landing, never bouncy. */
export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
};
export const spring = {
  snappy: { type: "spring", stiffness: 520, damping: 34 } as const,
  soft: { type: "spring", stiffness: 260, damping: 30 } as const,
};

/** Fades + lifts its children into place when mounted. `index` staggers
 * siblings (40 ms apart, capped so long lists never feel slow). */
export function Reveal({
  children,
  index = 0,
  className = "",
  y = 14,
  as = "div",
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
  y?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const Tag = m[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: ease.out, delay: Math.min(index, 8) * 0.04 }}
    >
      {children}
    </Tag>
  );
}

/** A number that counts to its value (and re-counts when it changes). Updates
 * the DOM text directly each frame instead of re-rendering React, so it is
 * free even on a slow phone. Reduced-motion users just see the value. */
export function NumberTicker({
  value,
  from = 0,
  format = (n: number) => Math.round(n).toLocaleString(),
  className = "",
  testId,
}: {
  value: number;
  from?: number;
  format?: (n: number) => string;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(from);
  const reduce = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce || previous.current === value) {
      node.textContent = format(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration: 0.8,
      ease: ease.out,
      onUpdate: (v) => {
        node.textContent = format(v);
      },
    });
    previous.current = value;
    return () => controls.stop();
    // `format` is intentionally excluded: callers pass inline functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);

  return (
    <span ref={ref} data-testid={testId} className={`tabular ${className}`}>
      {format(reduce ? value : from)}
    </span>
  );
}

/** Circular progress. `value`/`max` fill the ring; children render in the
 * middle. The arc draws itself in on mount and glides on updates. */
export function Ring({
  value,
  max,
  size = 72,
  stroke = 7,
  color = "var(--color-primary)",
  children,
  label,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${Math.round(pct * 100)} percent`}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-surface-container-high)"
          strokeWidth={stroke}
        />
        <m.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 0.9, ease: ease.out }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** A horizontal progress bar that grows from the left. */
export function MacroBar({
  value,
  max,
  color,
  height = 8,
}: {
  value: number;
  max: number;
  color: string;
  height?: number;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-surface-container"
      style={{ height }}
    >
      <m.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: ease.out }}
      />
    </div>
  );
}

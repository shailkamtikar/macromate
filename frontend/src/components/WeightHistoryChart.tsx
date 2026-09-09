"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface WeightPoint {
  date: string;
  weight_kg: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Real weight history from the user's own persisted weight_logs — never
 * fake/interpolated points. Shows a line graph once there's more than one
 * entry; a single-point state when there's exactly one; and an empty state
 * when there's none, rather than inventing a trend that isn't there. */
export function WeightHistoryChart({ userId }: { userId: string }) {
  const [points, setPoints] = useState<WeightPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("weight_logs")
      .select("weight_kg, logged_at")
      .eq("user_id", userId)
      .order("logged_at", { ascending: true })
      .limit(90)
      .then(({ data }) => {
        if (cancelled) return;
        setPoints(
          (data ?? []).map((r) => ({
            date: r.logged_at as string,
            weight_kg: r.weight_kg as number,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (points === null) {
    return (
      <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
        <p className="text-xs text-on-surface-variant">Loading weight history…</p>
      </section>
    );
  }

  if (points.length === 0) {
    return (
      <section className="rounded-[var(--radius-card)] border border-dashed border-outline-variant bg-surface-container-lowest p-4 text-xs text-on-surface-variant">
        No weight logged yet — log a weigh-in on your Profile to start tracking your trend.
      </section>
    );
  }

  const latest = points[points.length - 1];
  const first = points[0];

  if (points.length === 1) {
    return (
      <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Weight
        </p>
        <p className="font-display text-2xl font-bold text-on-surface">{latest.weight_kg}kg</p>
        <p className="text-xs text-on-surface-variant">
          Logged {formatDate(latest.date)} — log another weigh-in to see your trend.
        </p>
      </section>
    );
  }

  const trend = latest.weight_kg - first.weight_kg;
  const weights = points.map((p) => p.weight_kg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;
  const width = 300;
  const height = 100;
  const padX = 8;
  const padY = 10;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (p.weight_kg - min) / range) * (height - padY * 2);
    return { x, y };
  });
  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");

  return (
    <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Weight history
        </p>
        <span
          className={`flex items-center gap-1 text-xs font-semibold ${
            trend < 0 ? "text-primary" : trend > 0 ? "text-fat" : "text-on-surface-variant"
          }`}
        >
          <span className="material-symbols-outlined text-sm">
            {trend < 0 ? "trending_down" : trend > 0 ? "trending_up" : "trending_flat"}
          </span>
          {trend === 0 ? "Stable" : `${trend > 0 ? "+" : ""}${trend.toFixed(1)}kg`}
        </span>
      </div>
      <p className="mt-0.5 font-display text-2xl font-bold text-on-surface">
        {latest.weight_kg}kg <span className="text-xs font-normal text-on-surface-variant">latest</span>
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 w-full" preserveAspectRatio="none">
        <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={i === coords.length - 1 ? 3 : 2}
            fill="var(--color-primary)"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-on-surface-variant">
        <span>{formatDate(first.date)}</span>
        <span>{formatDate(latest.date)}</span>
      </div>
    </section>
  );
}

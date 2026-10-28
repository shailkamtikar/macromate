import { DayStatus, DaySummary } from "@/lib/api";
import { parseIso } from "@/lib/date";

export function statusDotClass(status: DayStatus | undefined, logged: boolean): string {
  if (!logged) return "bg-transparent";
  if (status === "ok") return "bg-primary";
  if (status === "high") return "bg-fat";
  if (status === "low") return "bg-carbs";
  return "bg-on-surface-variant";
}

export function describeDay(iso: string, summary: DaySummary | undefined): string {
  const label = parseIso(iso).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (!summary || !summary.logged) return `${label}, nothing logged`;
  return `${label}, ${Math.round(summary.calories)} kcal logged`;
}

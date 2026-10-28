// The user's *local* calendar date, as YYYY-MM-DD. Deliberately not
// `new Date().toISOString().slice(0, 10)` — that returns the UTC calendar
// date, which is the wrong day for part of the local day in any timezone
// ahead of UTC (e.g. right after local midnight in IST, toISOString()
// still reports "yesterday"). The backend interprets this string as a
// calendar date in the user's stored profile timezone.
export function localDateIso(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// --- Calendar helpers. All dates are "YYYY-MM-DD" strings in the user's local
// calendar; arithmetic goes through local-midnight Date objects with setDate,
// which is DST-safe (adding 24h would not be).

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** True for a real calendar date ("2026-02-30" is not one). */
export function isValidIso(value: string | null | undefined): value is string {
  if (!value || !ISO_RE.test(value)) return false;
  return localDateIso(parseIso(value)) === value;
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return localDateIso(d);
}

/** Monday of the week containing `iso` (matches the backend's week_bounds). */
export function startOfWeekIso(iso: string): string {
  const d = parseIso(iso);
  const mondayOffset = (d.getDay() + 6) % 7;
  return addDays(iso, -mondayOffset);
}

export function monthStartIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEndIso(iso: string): string {
  const d = parseIso(monthStartIso(iso));
  return localDateIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addMonths(iso: string, months: number): string {
  const d = parseIso(monthStartIso(iso));
  return localDateIso(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

export function formatDayLong(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function formatMonthYear(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The 7 ISO dates (Mon..Sun) of the week containing `iso`. */
export function weekDays(iso: string): string[] {
  const start = startOfWeekIso(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The dates to render for a month grid: Monday-first, padded with leading
 * and trailing days from the neighbouring months so every row has 7 cells. */
export function monthGrid(iso: string): string[] {
  const first = monthStartIso(iso);
  const last = monthEndIso(iso);
  const start = startOfWeekIso(first);
  const end = addDays(startOfWeekIso(last), 6);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

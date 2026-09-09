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

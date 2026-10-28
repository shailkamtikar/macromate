"""Timezone-aware day/week boundary helpers.

All persisted timestamps are UTC. "Today" and "this week" must be evaluated
in the user's local calendar day, not the server's UTC day, or logs made
near local midnight land on the wrong day for anyone outside UTC (this is
especially visible for timezones ahead of UTC, e.g. IST, where the first
few hours of the local day are still the previous UTC calendar date).
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "UTC"


def resolve_timezone(tz_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def local_today(tz_name: str | None) -> date:
    return datetime.now(resolve_timezone(tz_name)).date()


def day_bounds_utc(local_date: date, tz_name: str | None) -> tuple[datetime, datetime]:
    """UTC instants spanning the given calendar date in the user's timezone.
    Half-open [start, end): callers filtering with a `lt` end bound get an
    exact day; a `lte` end bound one microsecond before midnight is fine too."""
    tz = resolve_timezone(tz_name)
    start_local = datetime.combine(local_date, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def logged_at_for_date(
    log_date: date | None, tz_name: str | None
) -> tuple[str | None, date]:
    """(logged_at ISO string or None, resolved local date) for a log made on
    `log_date` in the user's timezone.

    None means "use the database default (now)" -- returned when no date was
    given or it is today, so ordinary logging is unchanged. A past date is
    stamped at 12:00 local that day: midday is never near a midnight/DST
    boundary, so the entry reliably lands on the chosen local day.
    Raises ValueError for a future date (nothing can be logged ahead)."""
    today = local_today(tz_name)
    if log_date is None or log_date == today:
        return None, today
    if log_date > today:
        raise ValueError("Can't log food or water for a future date")
    noon_local = datetime.combine(log_date, time(12, 0), tzinfo=resolve_timezone(tz_name))
    return noon_local.astimezone(timezone.utc).isoformat(), log_date


def infer_meal_type(tz_name: str | None) -> str:
    """Same time-of-day buckets the frontend already uses (see
    frontend/src/lib/servings.ts inferMealType) -- used when the Coach's
    add-food action has no meal stated or clearly implied, so a default
    still matches what the rest of the app would infer."""
    hour = datetime.now(resolve_timezone(tz_name)).hour
    if hour < 11:
        return "breakfast"
    if hour < 15:
        return "lunch"
    if hour < 18:
        return "snack"
    return "dinner"


def utc_timestamp_to_local_date(timestamp: str | datetime, tz_name: str | None) -> date:
    dt = (
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if isinstance(timestamp, str)
        else timestamp
    )
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(resolve_timezone(tz_name)).date()

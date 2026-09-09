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


def utc_timestamp_to_local_date(timestamp: str | datetime, tz_name: str | None) -> date:
    dt = (
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if isinstance(timestamp, str)
        else timestamp
    )
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(resolve_timezone(tz_name)).date()

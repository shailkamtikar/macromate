"""Pure unit tests for the timezone-aware day-boundary helpers. These exist
because of a real bug: every "today"/"this week" boundary used to be
computed in server UTC regardless of the user's actual location, so a user
in e.g. Asia/Kolkata (UTC+5:30) logging food at 12:30am local time had it
silently attributed to "yesterday" for roughly the first 5.5 hours of every
local day."""

from datetime import date, datetime, timezone

from app.domain.timeutil import day_bounds_utc, local_today, utc_timestamp_to_local_date


def test_local_today_ahead_of_utc_after_local_midnight():
    # 00:30 IST on 2026-01-02 is 19:00 UTC on 2026-01-01 — naive UTC-date
    # logic would report "today" as Jan 1st for this instant.
    fixed_utc = datetime(2026, 1, 1, 19, 0, tzinfo=timezone.utc)
    assert fixed_utc.astimezone(timezone.utc).date() == date(2026, 1, 1)

    # local_today() itself uses datetime.now(), so we assert the underlying
    # conversion directly via utc_timestamp_to_local_date instead of trying
    # to freeze "now".
    local_date = utc_timestamp_to_local_date(fixed_utc.isoformat(), "Asia/Kolkata")
    assert local_date == date(2026, 1, 2)


def test_utc_timestamp_to_local_date_matches_utc_when_timezone_is_utc():
    ts = "2026-03-05T10:15:00+00:00"
    assert utc_timestamp_to_local_date(ts, "UTC") == date(2026, 3, 5)
    assert utc_timestamp_to_local_date(ts, None) == date(2026, 3, 5)


def test_day_bounds_utc_spans_local_calendar_day_not_utc_day():
    start, end = day_bounds_utc(date(2026, 1, 2), "Asia/Kolkata")
    # IST midnight Jan 2nd is 18:30 UTC Jan 1st; the day ends 24h later.
    assert start == datetime(2026, 1, 1, 18, 30, tzinfo=timezone.utc)
    assert end == datetime(2026, 1, 2, 18, 30, tzinfo=timezone.utc)

    # A log made at 19:00 UTC Jan 1st (00:30 IST Jan 2nd) falls inside this
    # window — proving it would be correctly attributed to the local Jan 2nd
    # bucket rather than the UTC Jan 1st bucket.
    log_at = datetime(2026, 1, 1, 19, 0, tzinfo=timezone.utc)
    assert start <= log_at < end


def test_unknown_timezone_falls_back_to_utc_instead_of_crashing():
    assert local_today("Not/A_Real_Zone") == local_today("UTC")


def test_day_bounds_utc_for_utc_user_matches_calendar_midnight():
    start, end = day_bounds_utc(date(2026, 6, 15), "UTC")
    assert start == datetime(2026, 6, 15, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 6, 16, 0, 0, tzinfo=timezone.utc)

from datetime import datetime, time, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.achievements import calculate_logging_streak
from app.domain.notifications import NotificationTrigger, evaluate_triggers
from app.domain.timeutil import day_bounds_utc, resolve_timezone, utc_timestamp_to_local_date

router = APIRouter(prefix="/api/notification-settings", tags=["notifications"])


class NotificationSettingsOut(BaseModel):
    notifications_enabled: bool
    logging_reminders_enabled: bool
    reminder_times: list[str]
    streak_warnings_enabled: bool
    macro_nudges_enabled: bool
    friend_activity_enabled: bool
    quiet_hours_start: str | None
    quiet_hours_end: str | None


class NotificationSettingsIn(BaseModel):
    notifications_enabled: bool = True
    logging_reminders_enabled: bool = True
    reminder_times: list[str] = []
    streak_warnings_enabled: bool = True
    macro_nudges_enabled: bool = True
    friend_activity_enabled: bool = True
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None


class TriggerOut(BaseModel):
    kind: str
    title: str
    body: str


_DEFAULTS = NotificationSettingsOut(
    notifications_enabled=True,
    logging_reminders_enabled=True,
    reminder_times=[],
    streak_warnings_enabled=True,
    macro_nudges_enabled=True,
    friend_activity_enabled=True,
    quiet_hours_start=None,
    quiet_hours_end=None,
)


def _settings_out(r: dict) -> NotificationSettingsOut:
    return NotificationSettingsOut(
        notifications_enabled=r["notifications_enabled"],
        logging_reminders_enabled=r["logging_reminders_enabled"],
        reminder_times=r["reminder_times"],
        streak_warnings_enabled=r["streak_warnings_enabled"],
        macro_nudges_enabled=r["macro_nudges_enabled"],
        friend_activity_enabled=r["friend_activity_enabled"],
        quiet_hours_start=r["quiet_hours_start"],
        quiet_hours_end=r["quiet_hours_end"],
    )


@router.get("", response_model=NotificationSettingsOut)
def get_settings_(current_user: CurrentUserDep) -> NotificationSettingsOut:
    db = SupabaseAdmin()
    rows = db.select("notification_settings", {"user_id": f"eq.{current_user.user_id}", "select": "*"})
    if not rows:
        return _DEFAULTS
    return _settings_out(rows[0])


@router.put("", response_model=NotificationSettingsOut)
def update_settings(payload: NotificationSettingsIn, current_user: CurrentUserDep) -> NotificationSettingsOut:
    db = SupabaseAdmin()
    data = {
        "user_id": current_user.user_id,
        "notifications_enabled": payload.notifications_enabled,
        "logging_reminders_enabled": payload.logging_reminders_enabled,
        "reminder_times": payload.reminder_times,
        "streak_warnings_enabled": payload.streak_warnings_enabled,
        "macro_nudges_enabled": payload.macro_nudges_enabled,
        "friend_activity_enabled": payload.friend_activity_enabled,
        "quiet_hours_start": payload.quiet_hours_start,
        "quiet_hours_end": payload.quiet_hours_end,
    }
    row = db.insert("notification_settings", data, prefer="resolution=merge-duplicates,return=representation")[0]
    return _settings_out(row)


def _parse_time(value: str | None) -> time | None:
    if not value:
        return None
    return time.fromisoformat(value)


@router.get("/check-now", response_model=list[TriggerOut])
def check_triggers_now(current_user: CurrentUserDep) -> list[TriggerOut]:
    """Evaluates which notifications would fire right now for this user.
    This is the deterministic logic PRD §3.4 requires; it does not
    deliver a push (see app/core/fcm.py for why that's not wired up).
    Useful for demonstrating/testing the trigger logic against real data
    even without FCM configured."""
    db = SupabaseAdmin()
    profiles = db.select("profiles", {"id": f"eq.{current_user.user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    profile = profiles[0]

    settings_rows = db.select("notification_settings", {"user_id": f"eq.{current_user.user_id}", "select": "*"})
    settings = settings_rows[0] if settings_rows else _DEFAULTS.model_dump()

    tz_name = profile.get("timezone") or "UTC"
    tz = resolve_timezone(tz_name)
    now = datetime.now(tz)
    today = now.date()
    lookback_start, _ = day_bounds_utc(today - timedelta(days=60), tz_name)
    food_logs = db.select(
        "food_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": f"gte.{lookback_start.isoformat()}",
            "select": "logged_at,protein_g",
        },
    )
    logged_dates = {utc_timestamp_to_local_date(f["logged_at"], tz_name) for f in food_logs}
    streak = calculate_logging_streak(logged_dates, today)

    day_start, _ = day_bounds_utc(today, tz_name)
    today_protein = sum(
        f["protein_g"] for f in food_logs if datetime.fromisoformat(f["logged_at"]) >= day_start
    )
    remaining_protein = max(round(profile["target_protein_g"] - today_protein), 0)

    midnight_local = datetime.combine(today + timedelta(days=1), time.min, tzinfo=tz)
    hours_until_midnight = (midnight_local - now).total_seconds() / 3600

    reminder_times = [
        _parse_time(t) for t in settings.get("reminder_times", []) if _parse_time(t) is not None
    ]

    triggers: list[NotificationTrigger] = evaluate_triggers(
        now_time=now.time(),
        notifications_enabled=settings.get("notifications_enabled", True),
        logging_reminders_enabled=settings.get("logging_reminders_enabled", True),
        reminder_times=reminder_times,
        streak_warnings_enabled=settings.get("streak_warnings_enabled", True),
        macro_nudges_enabled=settings.get("macro_nudges_enabled", True),
        quiet_hours_start=_parse_time(settings.get("quiet_hours_start")),
        quiet_hours_end=_parse_time(settings.get("quiet_hours_end")),
        has_logged_anything_today=today in logged_dates,
        current_streak_days=streak,
        hours_until_midnight=hours_until_midnight,
        remaining_protein_g=remaining_protein,
        target_protein_g=profile["target_protein_g"],
    )
    return [TriggerOut(kind=t.kind, title=t.title, body=t.body) for t in triggers]

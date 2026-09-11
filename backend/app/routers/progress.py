from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin, SupabaseAdminError
from app.domain.progress import (
    WeekSummary,
    compute_improvement_areas,
    compute_weight_trend,
    compute_wins,
    group_food_logs_by_day,
    summarize_week,
    week_bounds,
)
from app.domain.timeutil import day_bounds_utc, local_today

router = APIRouter(prefix="/api/progress", tags=["progress"])


class WeekSummaryOut(BaseModel):
    week_start: str
    week_end: str
    avg_calories: float
    avg_protein_g: float
    avg_carbs_g: float
    avg_fat_g: float
    days_logged: int
    days_goal_hit: int
    adherence_pct: int
    # Calendar days this summary actually covers -- 7 for any complete
    # week, fewer only when this is the currently-in-progress week, so the
    # client can render "so far" framing instead of implying a full week.
    days_in_period: int
    is_partial: bool
    protein_days_hit: int
    protein_adherence_pct: int
    carbs_days_hit: int
    carbs_adherence_pct: int
    fat_days_hit: int
    fat_adherence_pct: int


class WeeklyReportOut(BaseModel):
    current: WeekSummaryOut
    previous: WeekSummaryOut
    weight_start_kg: float | None
    weight_end_kg: float | None
    weight_delta_kg: float | None
    wins: list[str]
    improvement_areas: list[str]


def _to_out(s: WeekSummary) -> WeekSummaryOut:
    return WeekSummaryOut(
        week_start=s.week_start.isoformat(),
        week_end=s.week_end.isoformat(),
        avg_calories=s.avg_calories,
        avg_protein_g=s.avg_protein_g,
        avg_carbs_g=s.avg_carbs_g,
        avg_fat_g=s.avg_fat_g,
        days_logged=s.days_logged,
        days_goal_hit=s.days_goal_hit,
        adherence_pct=s.adherence_pct,
        days_in_period=s.days_in_period,
        is_partial=s.is_partial,
        protein_days_hit=s.protein_days_hit,
        protein_adherence_pct=s.protein_adherence_pct,
        carbs_days_hit=s.carbs_days_hit,
        carbs_adherence_pct=s.carbs_adherence_pct,
        fat_days_hit=s.fat_days_hit,
        fat_adherence_pct=s.fat_adherence_pct,
    )


# Fields a persisted weekly_reports.payload must carry to reconstruct a
# WeekSummary. Kept explicit (rather than dataclasses.asdict) so a future
# WeekSummary field doesn't silently start round-tripping through storage
# without a conscious decision to persist it.
_PAYLOAD_FIELDS = (
    "avg_calories",
    "avg_protein_g",
    "avg_carbs_g",
    "avg_fat_g",
    "days_logged",
    "days_goal_hit",
    "adherence_pct",
    "days_in_period",
    "is_partial",
    "protein_days_hit",
    "protein_adherence_pct",
    "carbs_days_hit",
    "carbs_adherence_pct",
    "fat_days_hit",
    "fat_adherence_pct",
    "protein_days_below_target",
)


def _summary_to_payload(s: WeekSummary) -> dict:
    return {
        "week_start": s.week_start.isoformat(),
        "week_end": s.week_end.isoformat(),
        **{f: getattr(s, f) for f in _PAYLOAD_FIELDS},
    }


def _summary_from_payload(week_start: date, p: dict) -> WeekSummary:
    week_end = week_start + timedelta(days=6)
    return WeekSummary(
        week_start=week_start,
        week_end=date.fromisoformat(p["week_end"]) if "week_end" in p else week_end,
        **{f: p[f] for f in _PAYLOAD_FIELDS if f in p},
    )


def _fetch_week_food_logs(
    db: SupabaseAdmin, user_id: str, week_start: date, tz_name: str
) -> list[dict]:
    start, _ = day_bounds_utc(week_start, tz_name)
    _, end = day_bounds_utc(week_start + timedelta(days=6), tz_name)
    return db.select(
        "food_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": [f"gte.{start.isoformat()}", f"lt.{end.isoformat()}"],
        },
    )


def _week_summary(
    db: SupabaseAdmin,
    *,
    user_id: str,
    week_start: date,
    tz_name: str,
    target_calories: float,
    target_protein_g: float | None,
    target_carbs_g: float | None,
    target_fat_g: float | None,
    is_live: bool,
    days_in_period: int,
) -> WeekSummary:
    """A completed week's numbers never change once computed -- a later
    profile-target edit or (deliberate) historical log edit must not alter
    a week that's already over (PRD §15/§16: "avoid changing historical
    reports merely because current profile targets changed"). So a
    completed week is cached by (user, week_start) in `weekly_reports` on
    first computation and read from there on every later request; the
    currently-in-progress week is never cached and is always computed live,
    since its own data is still actively changing.

    The unique (user_id, week_start) constraint plus
    `resolution=ignore-duplicates` makes the cache write race-safe and
    idempotent -- concurrent requests for the same never-before-seen week
    compute the same deterministic result and never produce two rows."""
    if not is_live:
        cached = db.select(
            "weekly_reports",
            {
                "user_id": f"eq.{user_id}",
                "week_start": f"eq.{week_start.isoformat()}",
                "select": "payload",
            },
        )
        if cached:
            return _summary_from_payload(week_start, cached[0]["payload"])

    food_logs = _fetch_week_food_logs(db, user_id, week_start, tz_name)
    daily = group_food_logs_by_day(food_logs, week_start, tz_name)
    summary = summarize_week(
        daily,
        week_start,
        target_calories,
        target_protein_g=target_protein_g,
        target_carbs_g=target_carbs_g,
        target_fat_g=target_fat_g,
        days_in_period=days_in_period,
    )

    if not is_live:
        try:
            db.insert(
                "weekly_reports",
                {
                    "user_id": user_id,
                    "week_start": week_start.isoformat(),
                    "payload": _summary_to_payload(summary),
                },
                prefer="return=representation,resolution=ignore-duplicates",
                on_conflict="user_id,week_start",
            )
        except SupabaseAdminError:
            # Best-effort cache write -- a transient failure here must
            # never break the response; the next request simply recomputes
            # (and tries to cache) again.
            pass

    return summary


@router.get("/weekly", response_model=WeeklyReportOut)
def get_weekly_report(
    current_user: CurrentUserDep,
    ref_date: date | None = Query(default=None),
) -> WeeklyReportOut:
    db = SupabaseAdmin()
    profiles = db.select("profiles", {"id": f"eq.{current_user.user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    profile = profiles[0]
    target_calories = profile["target_calories"]
    target_protein_g = profile.get("target_protein_g")
    target_carbs_g = profile.get("target_carbs_g")
    target_fat_g = profile.get("target_fat_g")
    goal = profile.get("goal")
    tz_name = profile.get("timezone") or "UTC"

    today = local_today(tz_name)
    this_week_start, _ = week_bounds(today)
    current_week_start, _ = week_bounds(ref_date or today)
    previous_week_start = current_week_start - timedelta(days=7)

    current_is_live = current_week_start == this_week_start
    current_days_in_period = (
        max(1, min(7, (today - current_week_start).days + 1)) if current_is_live else 7
    )
    previous_is_live = previous_week_start == this_week_start

    current_summary = _week_summary(
        db,
        user_id=current_user.user_id,
        week_start=current_week_start,
        tz_name=tz_name,
        target_calories=target_calories,
        target_protein_g=target_protein_g,
        target_carbs_g=target_carbs_g,
        target_fat_g=target_fat_g,
        is_live=current_is_live,
        days_in_period=current_days_in_period,
    )
    previous_summary = _week_summary(
        db,
        user_id=current_user.user_id,
        week_start=previous_week_start,
        tz_name=tz_name,
        target_calories=target_calories,
        target_protein_g=target_protein_g,
        target_carbs_g=target_carbs_g,
        target_fat_g=target_fat_g,
        is_live=previous_is_live,
        days_in_period=7,
    )

    weight_start, _ = day_bounds_utc(current_week_start, tz_name)
    _, weight_end = day_bounds_utc(current_week_start + timedelta(days=6), tz_name)
    current_weight_logs = db.select(
        "weight_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": [f"gte.{weight_start.isoformat()}", f"lt.{weight_end.isoformat()}"],
        },
    )
    weight_trend = compute_weight_trend(current_weight_logs)

    return WeeklyReportOut(
        current=_to_out(current_summary),
        previous=_to_out(previous_summary),
        weight_start_kg=weight_trend.start_kg,
        weight_end_kg=weight_trend.end_kg,
        weight_delta_kg=weight_trend.delta_kg,
        wins=compute_wins(current_summary, previous_summary, weight_trend=weight_trend, goal=goal),
        improvement_areas=compute_improvement_areas(current_summary, previous_summary),
    )

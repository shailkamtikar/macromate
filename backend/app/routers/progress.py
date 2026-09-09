from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.progress import WeekSummary, WeightTrend, build_weekly_report, week_bounds
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


class WeeklyReportOut(BaseModel):
    current: WeekSummaryOut
    previous: WeekSummaryOut
    weight_start_kg: float | None
    weight_end_kg: float | None
    weight_delta_kg: float | None
    wins: list[str]


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


@router.get("/weekly", response_model=WeeklyReportOut)
def get_weekly_report(
    current_user: CurrentUserDep,
    ref_date: date | None = Query(default=None),
) -> WeeklyReportOut:
    db = SupabaseAdmin()
    profiles = db.select("profiles", {"id": f"eq.{current_user.user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    target_calories = profiles[0]["target_calories"]
    tz_name = profiles[0].get("timezone") or "UTC"

    current_week_start, _ = week_bounds(ref_date or local_today(tz_name))
    previous_week_start = current_week_start - timedelta(days=7)

    current_logs = _fetch_week_food_logs(db, current_user.user_id, current_week_start, tz_name)
    previous_logs = _fetch_week_food_logs(db, current_user.user_id, previous_week_start, tz_name)

    weight_start, _ = day_bounds_utc(current_week_start, tz_name)
    _, weight_end = day_bounds_utc(current_week_start + timedelta(days=6), tz_name)
    current_weight_logs = db.select(
        "weight_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": [f"gte.{weight_start.isoformat()}", f"lt.{weight_end.isoformat()}"],
        },
    )

    report = build_weekly_report(
        current_food_logs=current_logs,
        previous_food_logs=previous_logs,
        current_weight_logs=current_weight_logs,
        current_week_start=current_week_start,
        previous_week_start=previous_week_start,
        target_calories=target_calories,
        tz_name=tz_name,
    )

    return WeeklyReportOut(
        current=_to_out(report.current),
        previous=_to_out(report.previous),
        weight_start_kg=report.weight_trend.start_kg,
        weight_end_kg=report.weight_trend.end_kg,
        weight_delta_kg=report.weight_trend.delta_kg,
        wins=report.wins,
    )

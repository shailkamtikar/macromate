from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.achievements import STREAK_LOOKBACK_DAYS, build_achievements
from app.domain.timeutil import day_bounds_utc, local_today, utc_timestamp_to_local_date

router = APIRouter(prefix="/api", tags=["achievements"])


class AchievementsOut(BaseModel):
    current_streak_days: int
    milestones_hit: list[int]
    newest_milestone: int | None
    weight_lower_than_last: bool
    weight_delta_kg: float | None
    calorie_goal_hit_today: bool
    macro_goals_hit_today: dict[str, bool]


@router.get("/achievements", response_model=AchievementsOut)
def get_achievements(current_user: CurrentUserDep) -> AchievementsOut:
    db = SupabaseAdmin()
    profiles = db.select("profiles", {"id": f"eq.{current_user.user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    profile = profiles[0]
    tz_name = profile.get("timezone") or "UTC"

    today = local_today(tz_name)
    lookback_start, _ = day_bounds_utc(today - timedelta(days=STREAK_LOOKBACK_DAYS), tz_name)
    food_logs = db.select(
        "food_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": f"gte.{lookback_start.isoformat()}",
            "select": "logged_at,calories,protein_g,carbs_g,fat_g",
        },
    )
    logged_dates = {
        utc_timestamp_to_local_date(f["logged_at"], tz_name) for f in food_logs
    }

    day_start, day_end = day_bounds_utc(today, tz_name)
    today_logs = [
        f
        for f in food_logs
        if day_start <= datetime.fromisoformat(f["logged_at"]) < day_end
    ]
    consumed = {
        "calories": sum(f["calories"] for f in today_logs),
        "protein_g": sum(f["protein_g"] for f in today_logs),
        "carbs_g": sum(f["carbs_g"] for f in today_logs),
        "fat_g": sum(f["fat_g"] for f in today_logs),
    }

    weight_rows = db.select(
        "weight_logs",
        {"user_id": f"eq.{current_user.user_id}", "order": "logged_at.asc", "limit": "10"},
    )
    recent_weights = [
        (utc_timestamp_to_local_date(w["logged_at"], tz_name), w["weight_kg"])
        for w in weight_rows
    ]

    result = build_achievements(
        logged_dates=logged_dates,
        today=today,
        recent_weights_kg=recent_weights,
        consumed_calories=consumed["calories"],
        target_calories=profile["target_calories"],
        consumed_protein_g=consumed["protein_g"],
        target_protein_g=profile["target_protein_g"],
        consumed_carbs_g=consumed["carbs_g"],
        target_carbs_g=profile["target_carbs_g"],
        consumed_fat_g=consumed["fat_g"],
        target_fat_g=profile["target_fat_g"],
    )

    return AchievementsOut(
        current_streak_days=result.current_streak_days,
        milestones_hit=result.milestones_hit,
        newest_milestone=result.newest_milestone,
        weight_lower_than_last=result.weight_lower_than_last,
        weight_delta_kg=result.weight_delta_kg,
        calorie_goal_hit_today=result.calorie_goal_hit_today,
        macro_goals_hit_today=result.macro_goals_hit_today,
    )

"""Everything the dashboard shows for one calendar day, plus a lightweight
per-day overview of a date range for the calendar itself.

Dates are the USER's local calendar dates (profile timezone), exactly like
/api/food-logs?date=. Future dates are rejected: there is nothing to show or
log for them.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.day_summary import macro_status, targets_for_date
from app.domain.timeutil import day_bounds_utc, local_today, utc_timestamp_to_local_date
from app.routers.activity import ActivityLogOut
from app.routers.food import FoodLogOut, _food_log_out
from app.routers.water import GlassSizeOut, WaterLogOut, WaterSummaryResponse

router = APIRouter(prefix="/api/days", tags=["days"])

MAX_SUMMARY_DAYS = 62

Status = Literal["low", "ok", "high", "none"]

# Independent reads run concurrently (one network round-trip of latency
# instead of one per query).
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="days")


class TargetsOut(BaseModel):
    calories: int
    protein_g: int | None
    carbs_g: int | None
    fat_g: int | None
    water_goal_ml: int | None
    is_approximate: bool


class TotalsOut(BaseModel):
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class StatusOut(BaseModel):
    calories: Status
    protein: Status
    carbs: Status
    fat: Status


class DayOut(BaseModel):
    date: str
    is_today: bool
    timezone: str
    targets: TargetsOut
    consumed: TotalsOut
    status: StatusOut
    meals: list[FoodLogOut]
    water: WaterSummaryResponse
    glass_sizes: list[GlassSizeOut]
    activity: ActivityLogOut | None
    weight_kg: float | None


class DaySummaryOut(BaseModel):
    date: str
    logged: bool
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    water_ml: float
    target_calories: int
    status: StatusOut


def _load_profile(db: SupabaseAdmin, user_id: str) -> dict:
    profiles = db.select("profiles", {"id": f"eq.{user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    return profiles[0]


def _snapshots(db: SupabaseAdmin, user_id: str) -> list[dict]:
    return db.select(
        "daily_targets",
        {"user_id": f"eq.{user_id}", "select": "*", "order": "effective_from.asc"},
    )


def _statuses(consumed: dict, targets) -> StatusOut:
    return StatusOut(
        calories=macro_status(consumed["calories"], targets.calories),
        protein=macro_status(consumed["protein_g"], targets.protein_g),
        carbs=macro_status(consumed["carbs_g"], targets.carbs_g),
        fat=macro_status(consumed["fat_g"], targets.fat_g),
    )


@router.get("/summary", response_model=list[DaySummaryOut])
def days_summary(
    current_user: CurrentUserDep,
    start: date = Query(),
    end: date = Query(),
) -> list[DaySummaryOut]:
    """One entry per calendar day in [start, end], for the calendar's dots
    and the week overview. Declared before `/{day}` so "summary" is never
    parsed as a date."""
    if end < start:
        raise HTTPException(status_code=422, detail="end must not be before start")
    if (end - start).days + 1 > MAX_SUMMARY_DAYS:
        raise HTTPException(
            status_code=422, detail=f"Range is limited to {MAX_SUMMARY_DAYS} days"
        )

    db = SupabaseAdmin()
    user_id = current_user.user_id
    profile = _load_profile(db, user_id)
    tz_name = profile.get("timezone") or "UTC"
    if end > local_today(tz_name):
        raise HTTPException(status_code=422, detail="Future dates aren't available")

    range_start, _ = day_bounds_utc(start, tz_name)
    _, range_end = day_bounds_utc(end, tz_name)
    window = [f"gte.{range_start.isoformat()}", f"lt.{range_end.isoformat()}"]

    logs_f = _pool.submit(
        db.select_all,
        "food_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": window,
            "select": "logged_at,calories,protein_g,carbs_g,fat_g",
            "order": "logged_at.asc",
        },
    )
    water_f = _pool.submit(
        db.select_all,
        "water_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": window,
            "select": "logged_at,volume_ml",
            "order": "logged_at.asc",
        },
    )
    snapshots_f = _pool.submit(_snapshots, db, user_id)

    per_day: dict[date, dict[str, float]] = {}
    for row in logs_f.result():
        day = utc_timestamp_to_local_date(row["logged_at"], tz_name)
        d = per_day.setdefault(day, {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "water": 0.0})
        d["calories"] += row["calories"]
        d["protein_g"] += row["protein_g"]
        d["carbs_g"] += row["carbs_g"]
        d["fat_g"] += row["fat_g"]
    for row in water_f.result():
        day = utc_timestamp_to_local_date(row["logged_at"], tz_name)
        d = per_day.setdefault(day, {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "water": 0.0})
        d["water"] += row["volume_ml"]
    snapshots = snapshots_f.result()

    out: list[DaySummaryOut] = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        totals = per_day.get(day, {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "water": 0.0})
        targets = targets_for_date(snapshots, day, profile)
        out.append(
            DaySummaryOut(
                date=day.isoformat(),
                logged=totals["calories"] > 0,
                calories=round(totals["calories"], 1),
                protein_g=round(totals["protein_g"], 1),
                carbs_g=round(totals["carbs_g"], 1),
                fat_g=round(totals["fat_g"], 1),
                water_ml=round(totals["water"], 1),
                target_calories=targets.calories,
                status=_statuses(totals, targets),
            )
        )
    return out


@router.get("/{day}", response_model=DayOut)
def get_day(day: date, current_user: CurrentUserDep) -> DayOut:
    db = SupabaseAdmin()
    user_id = current_user.user_id
    profile = _load_profile(db, user_id)
    tz_name = profile.get("timezone") or "UTC"
    today = local_today(tz_name)
    if day > today:
        raise HTTPException(status_code=422, detail="Future dates aren't available")

    start, end = day_bounds_utc(day, tz_name)
    window = [f"gte.{start.isoformat()}", f"lt.{end.isoformat()}"]

    logs_f = _pool.submit(
        db.select,
        "food_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": window,
            "select": "*,food_items(name,serving_description)",
            "order": "logged_at.asc",
        },
    )
    water_f = _pool.submit(
        db.select,
        "water_logs",
        {"user_id": f"eq.{user_id}", "logged_at": window, "order": "logged_at.asc"},
    )
    glass_f = _pool.submit(
        db.select, "glass_sizes", {"user_id": f"eq.{user_id}", "order": "volume_ml.asc"}
    )
    activity_f = _pool.submit(
        db.select,
        "activity_logs",
        {"user_id": f"eq.{user_id}", "activity_date": f"eq.{day.isoformat()}", "limit": "1"},
    )
    weight_f = _pool.submit(
        db.select,
        "weight_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": window,
            "order": "logged_at.desc",
            "limit": "1",
        },
    )
    snapshots_f = _pool.submit(_snapshots, db, user_id)

    food_rows = logs_f.result()
    water_rows = water_f.result()
    meals = [_food_log_out(r, r.get("food_items")) for r in food_rows]
    consumed = {
        "calories": sum(r["calories"] for r in food_rows),
        "protein_g": sum(r["protein_g"] for r in food_rows),
        "carbs_g": sum(r["carbs_g"] for r in food_rows),
        "fat_g": sum(r["fat_g"] for r in food_rows),
    }
    targets = targets_for_date(snapshots_f.result(), day, profile)
    activity_rows = activity_f.result()
    weights = weight_f.result()
    water_logs = [WaterLogOut(**r) for r in water_rows]

    return DayOut(
        date=day.isoformat(),
        is_today=day == today,
        timezone=tz_name,
        targets=TargetsOut(
            calories=targets.calories,
            protein_g=targets.protein_g,
            carbs_g=targets.carbs_g,
            fat_g=targets.fat_g,
            water_goal_ml=targets.water_goal_ml,
            is_approximate=targets.is_approximate,
        ),
        consumed=TotalsOut(**consumed),
        status=_statuses(consumed, targets),
        meals=meals,
        water=WaterSummaryResponse(
            total_ml=sum(w.volume_ml for w in water_logs), logs=water_logs
        ),
        glass_sizes=[GlassSizeOut(**g) for g in glass_f.result()],
        activity=ActivityLogOut(**activity_rows[0]) if activity_rows else None,
        weight_kg=weights[0]["weight_kg"] if weights else None,
    )

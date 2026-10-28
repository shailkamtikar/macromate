"""Profile, targets and weight -- owned by the server.

The browser sends only the user's *inputs* (body stats, goal, preferences and
any calorie/macro choices). The server recomputes the targets with the same
deterministic engine as the preview endpoint and stores the result. Clients
can no longer write calorie/macro targets (or weight logs) directly to the
database, so a user can't set an absurd target to game the leaderboard's
discipline score.
"""

from datetime import date
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin, SupabaseAdminError
from app.domain.timeutil import logged_at_for_date
from app.routers.macros import MacroTargetsRequest, MacroTargetsResponse, compute_macro_targets

router = APIRouter(prefix="/api", tags=["profile"])

DietaryMode = Literal["vegetarian", "non_vegetarian", "egg_inclusive"]


class ProfileInput(MacroTargetsRequest):
    """Everything the profile form collects. Inherits the body-stat/goal/
    calorie/macro fields (and their validation) from the preview request."""

    username: str = Field(min_length=1, max_length=50)
    dietary_mode: DietaryMode = "non_vegetarian"
    leaderboard_visible: bool = True
    timezone: str | None = None


class ProfileOut(BaseModel):
    id: str
    username: str
    sex: str
    age_years: int
    height_cm: float
    activity_level: str
    goal: str
    dietary_mode: str
    target_calories: int
    target_protein_g: int
    target_carbs_g: int
    target_fat_g: int
    water_goal_ml: int | None
    leaderboard_visible: bool
    timezone: str
    rate_kg_per_week: float | None
    macro_mode: str


class ProfileSaved(BaseModel):
    profile: ProfileOut
    targets: MacroTargetsResponse
    weight_kg: float


class WeightIn(BaseModel):
    weight_kg: float = Field(gt=0, le=400)
    log_date: date | None = None


class WeightOut(BaseModel):
    id: str
    weight_kg: float
    logged_at: str


def _valid_timezone(name: str | None, fallback: str) -> str:
    if not name:
        return fallback
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail="Unknown timezone")
    return name


@router.get("/profile", response_model=ProfileOut)
def get_profile(current_user: CurrentUserDep) -> ProfileOut:
    rows = SupabaseAdmin().select(
        "profiles", {"id": f"eq.{current_user.user_id}", "select": "*"}
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    return ProfileOut(**{k: rows[0].get(k) for k in ProfileOut.model_fields})


@router.put("/profile", response_model=ProfileSaved)
def save_profile(payload: ProfileInput, current_user: CurrentUserDep) -> ProfileSaved:
    """Create or update the caller's profile. Targets are always recomputed
    here from the inputs -- whatever the client previewed is re-validated, so
    only values the engine would itself produce can be stored."""
    db = SupabaseAdmin()
    user_id = current_user.user_id

    # 422 (ValueError -> HTTPException) for out-of-range overrides, impossible
    # macro splits, etc. -- identical rules to the preview endpoint.
    computed = compute_macro_targets(payload)

    existing = db.select("profiles", {"id": f"eq.{user_id}", "select": "*"})
    previous = existing[0] if existing else None
    timezone_name = _valid_timezone(payload.timezone, (previous or {}).get("timezone") or "UTC")

    row = {
        "id": user_id,
        "username": payload.username.strip(),
        "sex": payload.sex.value,
        "age_years": payload.age_years,
        "height_cm": payload.height_cm,
        "activity_level": payload.activity_level.value,
        "goal": payload.goal.value,
        "rate_kg_per_week": None if payload.goal.value == "maintain" else payload.rate_kg_per_week,
        "macro_mode": payload.macro_mode,
        "dietary_mode": payload.dietary_mode,
        "leaderboard_visible": payload.leaderboard_visible,
        "target_calories": computed.targets.calories,
        "target_protein_g": computed.targets.protein_g,
        "target_carbs_g": computed.targets.carbs_g,
        "target_fat_g": computed.targets.fat_g,
        "water_goal_ml": computed.water_goal_ml,
        "timezone": timezone_name,
    }
    try:
        saved = db.insert(
            "profiles", row, prefer="resolution=merge-duplicates,return=representation", on_conflict="id"
        )[0]
    except SupabaseAdminError as exc:
        # profiles.username is unique.
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail="That username is already taken")
        raise

    # Log the weight only when it actually changed (or on first save), so
    # saving unrelated settings never spams weight_logs / skews the trend.
    latest = db.select(
        "weight_logs",
        {"user_id": f"eq.{user_id}", "order": "logged_at.desc", "limit": "1", "select": "weight_kg"},
    )
    if not latest or abs(latest[0]["weight_kg"] - payload.weight_kg) > 1e-9:
        db.insert("weight_logs", {"user_id": user_id, "weight_kg": payload.weight_kg})

    return ProfileSaved(
        profile=ProfileOut(**{k: saved.get(k) for k in ProfileOut.model_fields}),
        targets=computed,
        weight_kg=payload.weight_kg,
    )


@router.post("/weight-logs", response_model=WeightOut)
def log_weight(payload: WeightIn, current_user: CurrentUserDep) -> WeightOut:
    """A quick weight entry (the Progress page). `log_date` backfills a past
    day exactly like food/water logs: omitted/today = now, past = local noon,
    future = rejected."""
    db = SupabaseAdmin()
    data = {"user_id": current_user.user_id, "weight_kg": payload.weight_kg}
    if payload.log_date is not None:
        profiles = db.select(
            "profiles", {"id": f"eq.{current_user.user_id}", "select": "timezone"}
        )
        tz_name = profiles[0].get("timezone") if profiles else None
        try:
            logged_at, _ = logged_at_for_date(payload.log_date, tz_name)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if logged_at is not None:
            data["logged_at"] = logged_at
    row = db.insert("weight_logs", data)[0]
    return WeightOut(id=row["id"], weight_kg=row["weight_kg"], logged_at=row["logged_at"])


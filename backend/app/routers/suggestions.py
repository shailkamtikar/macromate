from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.macros import MacroTargets, calculate_remaining_macros
from app.domain.timeutil import day_bounds_utc, local_today

router = APIRouter(prefix="/api", tags=["suggestions"])


class SuggestedFood(BaseModel):
    id: str
    name: str
    brand: str | None
    serving_description: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    verified: bool


class SuggestionsResponse(BaseModel):
    message: str
    remaining_calories: int
    remaining_protein_g: int
    suggestions: list[SuggestedFood]


@router.get("/suggestions", response_model=SuggestionsResponse)
def get_suggestions(current_user: CurrentUserDep) -> SuggestionsResponse:
    db = SupabaseAdmin()

    profiles = db.select("profiles", {"id": f"eq.{current_user.user_id}", "select": "*"})
    profile = profiles[0] if profiles else None

    tz_name = (profile.get("timezone") if profile else None) or "UTC"
    today = local_today(tz_name)
    day_start, day_end = day_bounds_utc(today, tz_name)
    food_logs = db.select(
        "food_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
        },
    )
    consumed_calories = sum(f["calories"] for f in food_logs)
    consumed_protein = sum(f["protein_g"] for f in food_logs)
    consumed_carbs = sum(f["carbs_g"] for f in food_logs)
    consumed_fat = sum(f["fat_g"] for f in food_logs)

    if profile:
        target = MacroTargets(
            calories=profile["target_calories"],
            protein_g=profile["target_protein_g"],
            carbs_g=profile["target_carbs_g"],
            fat_g=profile["target_fat_g"],
        )
    else:
        # No profile yet — fall back to a generic budget rather than 500ing;
        # the frontend always has a profile by the time this is reachable,
        # but the endpoint should degrade gracefully, not crash.
        target = MacroTargets(calories=2000, protein_g=150, carbs_g=200, fat_g=65)

    remaining = calculate_remaining_macros(
        target,
        consumed_calories=round(consumed_calories),
        consumed_protein_g=round(consumed_protein),
        consumed_carbs_g=round(consumed_carbs),
        consumed_fat_g=round(consumed_fat),
    )

    rows = db.rpc(
        "suggest_foods_for_remaining",
        {
            "remaining_calories": remaining.calories,
            "remaining_protein_g": remaining.protein_g,
            "match_limit": 3,
        },
    )
    suggestions = [SuggestedFood(**r) for r in rows]

    if not suggestions:
        message = f"You have {remaining.calories} kcal left today — nothing in the food database fits that budget yet. Try logging a custom food."
    else:
        names = ", ".join(s.name for s in suggestions)
        message = (
            f"You've got {remaining.calories} kcal and {remaining.protein_g}g protein left — "
            f"try: {names}."
        )

    return SuggestionsResponse(
        message=message,
        remaining_calories=remaining.calories,
        remaining_protein_g=remaining.protein_g,
        suggestions=suggestions,
    )

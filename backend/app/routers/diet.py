from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.gemini import GeminiUnavailable, generate_text
from app.core.supabase_admin import SupabaseAdmin
from app.domain.diet_generator import (
    GeneratedMeal,
    build_system_instruction,
    parse_and_validate_plan,
)
from app.domain.macros import MacroTargets

router = APIRouter(prefix="/api/ai", tags=["ai"])


class GenerateDietRequest(BaseModel):
    dietary_mode: str = Field(pattern="^(vegetarian|non_vegetarian|egg_inclusive)$")


class GenerateDietResponse(BaseModel):
    meals: list[GeneratedMeal]
    notes: str
    target: MacroTargets
    plan_total_calories: float
    within_tolerance: bool


@router.post("/generate-diet", response_model=GenerateDietResponse)
def generate_diet(payload: GenerateDietRequest, current_user: CurrentUserDep) -> GenerateDietResponse:
    db = SupabaseAdmin()
    profiles = db.select("profiles", {"id": f"eq.{current_user.user_id}", "select": "*"})
    if not profiles:
        raise HTTPException(status_code=404, detail="Complete onboarding first")
    profile = profiles[0]

    targets = MacroTargets(
        calories=profile["target_calories"],
        protein_g=profile["target_protein_g"],
        carbs_g=profile["target_carbs_g"],
        fat_g=profile["target_fat_g"],
    )

    system_instruction = build_system_instruction(targets, payload.dietary_mode)
    try:
        raw = generate_text(
            "Generate today's meal plan.", system_instruction=system_instruction, timeout=25
        )
    except GeminiUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Diet generation is temporarily unavailable: {exc}")

    try:
        validated = parse_and_validate_plan(raw, targets)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Could not generate a valid plan: {exc}")

    return GenerateDietResponse(
        meals=validated.plan.meals,
        notes=validated.plan.notes,
        target=targets,
        plan_total_calories=validated.total_calories,
        within_tolerance=validated.within_tolerance,
    )

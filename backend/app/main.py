from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from app.core.auth import CurrentUserDep
from app.core.config import get_settings
from app.routers.achievements import router as achievements_router
from app.routers.activity import router as activity_router
from app.routers.ai_food import router as ai_food_router
from app.routers.coach import router as coach_router
from app.routers.diet import router as diet_router
from app.routers.food import router as food_router
from app.routers.friends import router as friends_router
from app.routers.notifications import router as notifications_router
from app.routers.progress import router as progress_router
from app.routers.suggestions import router as suggestions_router
from app.routers.water import router as water_router
from app.domain.macros import (
    ActivityLevel,
    BiologicalSex,
    Goal,
    MacroTargets,
    bmi_category,
    calculate_bmi,
    calculate_recommended_calories,
    macros_for_calories,
    suggested_water_goal_ml,
    validate_calorie_override,
    validate_custom_macros,
)

settings = get_settings()

app = FastAPI(title="MacroMate API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(food_router)
app.include_router(water_router)
app.include_router(ai_food_router)
app.include_router(coach_router)
app.include_router(suggestions_router)
app.include_router(diet_router)
app.include_router(progress_router)
app.include_router(achievements_router)
app.include_router(friends_router)
app.include_router(notifications_router)
app.include_router(activity_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}


@app.get("/api/me")
def me(current_user: CurrentUserDep) -> dict[str, str | None]:
    """Proves the Supabase Auth JWT verification pipeline works end to end:
    requires a real access token from a real Supabase Auth session, verified
    against the project's live JWKS — no bypass, no fake session."""
    return {"user_id": current_user.user_id, "email": current_user.email}


class MacroTargetsRequest(BaseModel):
    weight_kg: float = Field(gt=0)
    height_cm: float = Field(gt=0)
    age_years: int = Field(gt=0)
    sex: BiologicalSex
    activity_level: ActivityLevel
    goal: Goal
    # Required for cut/bulk (validated against per-goal safe bounds in
    # app/domain/macros.py); ignored for maintain. Omitting it entirely
    # falls back to the previous fixed per-goal adjustment.
    rate_kg_per_week: float | None = None
    # If set, overrides the recommended calorie target (must be within
    # CALORIE_OVERRIDE_TOLERANCE_KCAL of it and above the safety floor).
    calorie_override: int | None = None
    macro_mode: Literal["automatic", "custom"] = "automatic"
    custom_protein_g: int | None = None
    custom_carbs_g: int | None = None
    custom_fat_g: int | None = None

    @model_validator(mode="after")
    def _custom_macros_require_all_three(self) -> "MacroTargetsRequest":
        if self.macro_mode == "custom" and (
            self.custom_protein_g is None
            or self.custom_carbs_g is None
            or self.custom_fat_g is None
        ):
            raise ValueError(
                "Custom macro mode requires custom_protein_g, custom_carbs_g, and custom_fat_g."
            )
        return self


class MacroTargetsResponse(BaseModel):
    bmi: float
    bmi_category: str
    bmr: int
    recommended_calories: int
    targets: MacroTargets
    water_goal_ml: int


@app.post("/api/macro-targets", response_model=MacroTargetsResponse)
def macro_targets(payload: MacroTargetsRequest) -> MacroTargetsResponse:
    """Computes a user's BMI, recommended calorie target (from a
    deterministic BMR -> TDEE -> rate-adjusted pipeline — never Gemini),
    final calorie/macro targets (honoring an optional user override and/or
    custom macro split), and suggested water goal. Pure, deterministic
    math (app/domain/macros.py) — no AI, no external calls."""
    bmi = calculate_bmi(payload.weight_kg, payload.height_cm)

    try:
        recommended = calculate_recommended_calories(
            weight_kg=payload.weight_kg,
            height_cm=payload.height_cm,
            age_years=payload.age_years,
            sex=payload.sex,
            activity_level=payload.activity_level,
            goal=payload.goal,
            rate_kg_per_week=payload.rate_kg_per_week,
        )

        if payload.calorie_override is not None:
            validate_calorie_override(
                payload.calorie_override, recommended.calories, recommended.bmr
            )
            final_calories = payload.calorie_override
        else:
            final_calories = recommended.calories

        if payload.macro_mode == "custom":
            assert payload.custom_protein_g is not None
            assert payload.custom_carbs_g is not None
            assert payload.custom_fat_g is not None
            validate_custom_macros(
                payload.custom_protein_g,
                payload.custom_carbs_g,
                payload.custom_fat_g,
                final_calories,
            )
            targets = MacroTargets(
                calories=final_calories,
                protein_g=payload.custom_protein_g,
                carbs_g=payload.custom_carbs_g,
                fat_g=payload.custom_fat_g,
            )
        else:
            targets = macros_for_calories(
                final_calories,
                payload.weight_kg,
                payload.goal,
                reference_calories=recommended.calories,
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    water_goal_ml = suggested_water_goal_ml(payload.weight_kg, payload.activity_level)
    return MacroTargetsResponse(
        bmi=bmi,
        bmi_category=bmi_category(bmi),
        bmr=recommended.bmr,
        recommended_calories=recommended.calories,
        targets=targets,
        water_goal_ml=water_goal_ml,
    )

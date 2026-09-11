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
    carbs_from_remainder,
    low_calorie_warning,
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
    #: Maintenance calories — estimated TDEE, no cut/bulk adjustment
    #: (section 2). Identical to `tdee`; exposed under both names since the
    #: UI shows it as a named "estimated maintenance" figure.
    tdee: int
    maintenance_calories: int
    recommended_calories: int
    #: The rate the user actually asked for (None for maintain, or if the
    #: request omitted it and fell back to the legacy fixed adjustment).
    requested_rate_kg_per_week: float | None
    #: The rate actually applied after the feasibility policy — equals
    #: requested_rate_kg_per_week unless is_rate_capped is true.
    applied_rate_kg_per_week: float | None
    is_rate_capped: bool
    cap_reason: Literal["tdee_fraction", "bodyweight_percent", "absolute_floor"] | None
    cap_explanation: str | None
    daily_energy_change_kcal: int
    low_calorie_warning: str | None
    targets: MacroTargets
    water_goal_ml: int


@app.post("/api/macro-targets", response_model=MacroTargetsResponse)
def macro_targets(payload: MacroTargetsRequest) -> MacroTargetsResponse:
    """Computes a user's BMI, recommended calorie target (from a
    deterministic BMR -> TDEE -> feasibility-checked rate adjustment —
    never Gemini), final calorie/macro targets (honoring an optional user
    override and/or custom macro split), and suggested water goal. Pure,
    deterministic math (app/domain/macros.py) — no AI, no external calls."""
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

        # A manual calorie_override only ever changes which calorie number
        # feeds the macro split below (macros_for_calories(final_calories,
        # ...)) -- `recommended` above was already computed once, from the
        # profile's own weight/height/age/sex/activity_level, and is never
        # recomputed here. An override can never feed back into BMR/TDEE,
        # and it never implies any change in the user's body weight; the
        # profile's real weight_kg is still what protein/fat grams are
        # anchored to (see macros_for_calories) regardless of which
        # calorie number is finally chosen. Protein/fat legitimately stay
        # stable across a moderate override for exactly this reason -- see
        # test_manual_override_changes_only_calories_and_macros_not_tdee_or_bodyweight.
        if payload.calorie_override is not None:
            validate_calorie_override(payload.calorie_override, recommended.calories)
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
            # Carbs are always recalculated as the exact remainder — never
            # trusted verbatim from the client — so the response can never
            # show a calorie target that disagrees with its own macros
            # (the ~2054-vs-2000 class of bug). Protein/fat stay exactly
            # what the user chose; only carbs is silently fine-tuned.
            carbs_g = carbs_from_remainder(
                final_calories, payload.custom_protein_g, payload.custom_fat_g
            )
            targets = MacroTargets(
                calories=final_calories,
                protein_g=payload.custom_protein_g,
                carbs_g=carbs_g,
                fat_g=payload.custom_fat_g,
            )
        else:
            targets = macros_for_calories(final_calories, payload.weight_kg, payload.goal)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    water_goal_ml = suggested_water_goal_ml(payload.weight_kg, payload.activity_level)
    return MacroTargetsResponse(
        bmi=bmi,
        bmi_category=bmi_category(bmi),
        bmr=recommended.bmr,
        tdee=recommended.tdee,
        maintenance_calories=recommended.maintenance_calories,
        recommended_calories=recommended.calories,
        requested_rate_kg_per_week=recommended.requested_rate_kg_per_week,
        applied_rate_kg_per_week=recommended.applied_rate_kg_per_week,
        is_rate_capped=recommended.is_rate_capped,
        cap_reason=recommended.cap_reason,
        cap_explanation=recommended.cap_explanation,
        daily_energy_change_kcal=recommended.daily_energy_change_kcal,
        low_calorie_warning=low_calorie_warning(final_calories),
        targets=targets,
        water_goal_ml=water_goal_ml,
    )

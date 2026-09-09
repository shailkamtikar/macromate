from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.config import get_settings
from app.routers.ai_food import router as ai_food_router
from app.routers.coach import router as coach_router
from app.routers.food import router as food_router
from app.routers.water import router as water_router
from app.domain.macros import (
    ActivityLevel,
    BiologicalSex,
    Goal,
    MacroTargets,
    bmi_category,
    calculate_bmi,
    calculate_macro_targets,
    suggested_water_goal_ml,
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
    weight_kg: float
    height_cm: float
    age_years: int
    sex: BiologicalSex
    activity_level: ActivityLevel
    goal: Goal


class MacroTargetsResponse(BaseModel):
    bmi: float
    bmi_category: str
    targets: MacroTargets
    water_goal_ml: int


@app.post("/api/macro-targets", response_model=MacroTargetsResponse)
def macro_targets(payload: MacroTargetsRequest) -> MacroTargetsResponse:
    """Computes a user's BMI, daily calorie/macro targets, and suggested
    water goal. Pure, deterministic math (app/domain/macros.py) — no AI,
    no external calls."""
    bmi = calculate_bmi(payload.weight_kg, payload.height_cm)
    targets = calculate_macro_targets(
        weight_kg=payload.weight_kg,
        height_cm=payload.height_cm,
        age_years=payload.age_years,
        sex=payload.sex,
        activity_level=payload.activity_level,
        goal=payload.goal,
    )
    water_goal_ml = suggested_water_goal_ml(payload.weight_kg, payload.activity_level)
    return MacroTargetsResponse(
        bmi=bmi,
        bmi_category=bmi_category(bmi),
        targets=targets,
        water_goal_ml=water_goal_ml,
    )

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.core.config import get_settings
from app.domain.macros import (
    ActivityLevel,
    BiologicalSex,
    Goal,
    MacroTargets,
    bmi_category,
    calculate_bmi,
    calculate_macro_targets,
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}


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


@app.post("/api/macro-targets", response_model=MacroTargetsResponse)
def macro_targets(payload: MacroTargetsRequest) -> MacroTargetsResponse:
    """Computes a user's BMI and daily calorie/macro targets. Pure, deterministic
    math (app/domain/macros.py) — no AI, no external calls."""
    bmi = calculate_bmi(payload.weight_kg, payload.height_cm)
    targets = calculate_macro_targets(
        weight_kg=payload.weight_kg,
        height_cm=payload.height_cm,
        age_years=payload.age_years,
        sex=payload.sex,
        activity_level=payload.activity_level,
        goal=payload.goal,
    )
    return MacroTargetsResponse(
        bmi=bmi, bmi_category=bmi_category(bmi), targets=targets
    )

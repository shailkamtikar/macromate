"""Deterministic nutrition math: BMI, BMR/TDEE, calorie targets, macro splits,
and remaining-macro calculations.

This module is the single source of truth for every number MacroMate shows a
user or hands to the AI layer for phrasing (PRD §3.3, §3.5). It must stay
pure and dependency-free so it's trivially unit-testable and so the chatbot
never has to (and never should) compute nutrition numbers itself — it only
narrates numbers this module already computed.
"""

from dataclasses import dataclass
from enum import Enum


class BiologicalSex(str, Enum):
    """Input to the Mifflin-St Jeor BMR formula, which differs by sex."""

    MALE = "male"
    FEMALE = "female"


class ActivityLevel(str, Enum):
    SEDENTARY = "sedentary"
    LIGHT = "light"
    MODERATE = "moderate"
    ACTIVE = "active"
    VERY_ACTIVE = "very_active"


class Goal(str, Enum):
    CUT = "cut"
    MAINTAIN = "maintain"
    BULK = "bulk"


_ACTIVITY_MULTIPLIERS: dict[ActivityLevel, float] = {
    ActivityLevel.SEDENTARY: 1.2,
    ActivityLevel.LIGHT: 1.375,
    ActivityLevel.MODERATE: 1.55,
    ActivityLevel.ACTIVE: 1.725,
    ActivityLevel.VERY_ACTIVE: 1.9,
}

# Calorie adjustment applied to TDEE for non-maintenance goals. Cut targets a
# ~0.45kg/week deficit (~500 kcal/day); bulk targets a lean ~0.25kg/week
# surplus (~300 kcal/day) to limit fat gain.
_GOAL_CALORIE_ADJUSTMENT: dict[Goal, int] = {
    Goal.CUT: -500,
    Goal.MAINTAIN: 0,
    Goal.BULK: 300,
}

# Protein target in g/kg bodyweight by goal. Higher on a cut to preserve lean
# mass in a deficit; standard range on a bulk/maintenance.
_GOAL_PROTEIN_G_PER_KG: dict[Goal, float] = {
    Goal.CUT: 2.2,
    Goal.MAINTAIN: 2.0,
    Goal.BULK: 1.8,
}

# Fat as a fraction of total daily calories; remainder goes to carbs.
_FAT_CALORIE_FRACTION = 0.25

BMI_CATEGORIES: tuple[tuple[float, str], ...] = (
    (18.5, "underweight"),
    (25.0, "healthy"),
    (30.0, "overweight"),
    (float("inf"), "obese"),
)


@dataclass(frozen=True)
class MacroTargets:
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int


@dataclass(frozen=True)
class RemainingMacros:
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int


def calculate_bmi(weight_kg: float, height_cm: float) -> float:
    if weight_kg <= 0 or height_cm <= 0:
        raise ValueError("weight_kg and height_cm must be positive")
    height_m = height_cm / 100
    return round(weight_kg / (height_m**2), 1)


def bmi_category(bmi: float) -> str:
    for threshold, label in BMI_CATEGORIES:
        if bmi < threshold:
            return label
    return BMI_CATEGORIES[-1][1]


def calculate_bmr(
    weight_kg: float, height_cm: float, age_years: int, sex: BiologicalSex
) -> float:
    """Mifflin-St Jeor equation."""
    if age_years <= 0:
        raise ValueError("age_years must be positive")
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age_years
    return base + (5 if sex is BiologicalSex.MALE else -161)


def calculate_tdee(bmr: float, activity_level: ActivityLevel) -> float:
    return bmr * _ACTIVITY_MULTIPLIERS[activity_level]


def calculate_macro_targets(
    weight_kg: float,
    height_cm: float,
    age_years: int,
    sex: BiologicalSex,
    activity_level: ActivityLevel,
    goal: Goal,
) -> MacroTargets:
    """Full pipeline: BMR -> TDEE -> goal-adjusted calories -> macro split."""
    bmr = calculate_bmr(weight_kg, height_cm, age_years, sex)
    tdee = calculate_tdee(bmr, activity_level)
    calories = round(tdee + _GOAL_CALORIE_ADJUSTMENT[goal])

    protein_g = round(weight_kg * _GOAL_PROTEIN_G_PER_KG[goal])
    fat_g = round((calories * _FAT_CALORIE_FRACTION) / 9)
    remaining_calories_for_carbs = calories - (protein_g * 4) - (fat_g * 9)
    carbs_g = max(round(remaining_calories_for_carbs / 4), 0)

    return MacroTargets(
        calories=calories, protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g
    )


def suggested_water_goal_ml(weight_kg: float, activity_level: ActivityLevel) -> int:
    """35 ml/kg bodyweight is a standard general hydration guideline; add a
    flat 500ml for more active levels to account for extra fluid loss.
    Editable by the user afterward (PRD §3.1) — this is only the suggested
    starting value."""
    base = weight_kg * 35
    if activity_level in (ActivityLevel.ACTIVE, ActivityLevel.VERY_ACTIVE):
        base += 500
    return round(base)


def calculate_remaining_macros(
    targets: MacroTargets,
    consumed_calories: int,
    consumed_protein_g: int,
    consumed_carbs_g: int,
    consumed_fat_g: int,
) -> RemainingMacros:
    """Remaining budget for the day, used by both the UI and the food-suggestion
    matcher (PRD §3.5). Never goes negative — over-budget is a UI/coach
    concern, not a math concern."""
    return RemainingMacros(
        calories=max(targets.calories - consumed_calories, 0),
        protein_g=max(targets.protein_g - consumed_protein_g, 0),
        carbs_g=max(targets.carbs_g - consumed_carbs_g, 0),
        fat_g=max(targets.fat_g - consumed_fat_g, 0),
    )

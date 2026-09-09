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

# Standard estimate: ~7700 kcal of deficit/surplus per kg of body weight
# change (the widely-cited "3500 kcal per lb" rule converted to kg).
KG_PER_WEEK_TO_DAILY_KCAL = 7700 / 7

# Rate choices surfaced in onboarding/profile. Loss is capped at 1 kg/week —
# already the generally-accepted safe upper bound for sustainable fat loss.
# Gain is offered as a single "lean bulk" rate to limit fat gain, per PRD.
CUT_RATE_OPTIONS_KG_PER_WEEK: tuple[float, ...] = (0.5, 0.75, 1.0)
BULK_RATE_OPTIONS_KG_PER_WEEK: tuple[float, ...] = (0.25,)
MAX_CUT_RATE_KG_PER_WEEK = 1.0
MAX_BULK_RATE_KG_PER_WEEK = 0.5  # server-side ceiling; UI only ever offers 0.25

# Absolute safety floor for a daily calorie target, regardless of how large
# a deficit the selected rate implies. 1200 kcal/day is a widely-cited
# minimum for adults; never automatically recommend or accept less.
MIN_SAFE_DAILY_CALORIES = 1200

# A user may nudge the recommended calorie target up/down by at most this
# many kcal — enough to matter, not enough to silently create an unsafe or
# nonsensical target.
CALORIE_OVERRIDE_TOLERANCE_KCAL = 500

# Custom macros' implied calories (protein*4 + carbs*4 + fat*9) must land
# within this fraction of the selected calorie target.
MACRO_CALORIE_TOLERANCE_PCT = 0.05

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


def calorie_adjustment_for_rate(goal: Goal, rate_kg_per_week: float) -> int:
    """Daily calorie adjustment implied by a target weekly weight-change
    rate. Bounded per goal so an onboarding/profile caller can't request an
    obviously unsafe deficit or surplus."""
    if goal is Goal.MAINTAIN:
        return 0
    if goal is Goal.CUT:
        if not (0 < rate_kg_per_week <= MAX_CUT_RATE_KG_PER_WEEK):
            raise ValueError(
                f"Weight-loss rate must be between 0 and {MAX_CUT_RATE_KG_PER_WEEK} kg/week"
            )
        return -round(rate_kg_per_week * KG_PER_WEEK_TO_DAILY_KCAL)
    if goal is Goal.BULK:
        if not (0 < rate_kg_per_week <= MAX_BULK_RATE_KG_PER_WEEK):
            raise ValueError(
                f"Weight-gain rate must be between 0 and {MAX_BULK_RATE_KG_PER_WEEK} kg/week"
            )
        return round(rate_kg_per_week * KG_PER_WEEK_TO_DAILY_KCAL)
    raise ValueError(f"Unknown goal: {goal}")


def safe_calorie_floor(bmr: float) -> int:
    """A recommended or user-adjusted calorie target should never drop
    below this, regardless of goal/rate — eating under BMR (or under the
    generally-cited 1200 kcal/day floor) isn't a sustainable target."""
    return max(MIN_SAFE_DAILY_CALORIES, round(bmr))


def macros_for_calories(calories: int, weight_kg: float, goal: Goal) -> MacroTargets:
    """Splits an already-decided calorie target into protein/fat/carbs.
    Shared by the recommended-target pipeline and by "recompute macros
    after the user overrode calories" — the split logic is identical
    either way, only where `calories` came from differs."""
    protein_g = round(weight_kg * _GOAL_PROTEIN_G_PER_KG[goal])
    fat_g = round((calories * _FAT_CALORIE_FRACTION) / 9)
    remaining_calories_for_carbs = calories - (protein_g * 4) - (fat_g * 9)
    carbs_g = max(round(remaining_calories_for_carbs / 4), 0)
    return MacroTargets(calories=calories, protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)


@dataclass(frozen=True)
class RecommendedCalories:
    calories: int
    bmr: int
    tdee: int


def calculate_recommended_calories(
    weight_kg: float,
    height_cm: float,
    age_years: int,
    sex: BiologicalSex,
    activity_level: ActivityLevel,
    goal: Goal,
    rate_kg_per_week: float | None = None,
) -> RecommendedCalories:
    """BMR -> TDEE -> goal/rate-adjusted calories, floored at a safe
    minimum. `rate_kg_per_week` is required for cut/bulk (validated by
    calorie_adjustment_for_rate); omitting it falls back to the previous
    fixed per-goal adjustment for backward compatibility."""
    bmr = calculate_bmr(weight_kg, height_cm, age_years, sex)
    tdee = calculate_tdee(bmr, activity_level)
    if rate_kg_per_week is not None:
        adjustment = calorie_adjustment_for_rate(goal, rate_kg_per_week)
    else:
        adjustment = _GOAL_CALORIE_ADJUSTMENT[goal]
    calories = max(round(tdee + adjustment), safe_calorie_floor(bmr))
    return RecommendedCalories(calories=calories, bmr=round(bmr), tdee=round(tdee))


def validate_calorie_override(calories: int, recommended: int, bmr: float) -> None:
    """A user may nudge the recommended target, but not past the safety
    floor and not by more than the allowed tolerance in either direction —
    prevents silently creating a mathematically-unsafe or nonsensical
    target through the slider/input."""
    floor = safe_calorie_floor(bmr)
    if calories < floor:
        raise ValueError(
            f"Calorie target can't go below {floor} kcal/day — that's below what your "
            "body needs at rest."
        )
    if abs(calories - recommended) > CALORIE_OVERRIDE_TOLERANCE_KCAL:
        raise ValueError(
            f"Calorie target can only be adjusted by up to {CALORIE_OVERRIDE_TOLERANCE_KCAL} "
            f"kcal from the recommended {recommended} kcal."
        )


def validate_custom_macros(
    protein_g: float, carbs_g: float, fat_g: float, target_calories: int
) -> None:
    """Custom macros must roughly add up to the calorie target — rejects
    contradictory input with a specific, actionable message rather than
    silently accepting numbers that don't reconcile."""
    if protein_g < 0 or carbs_g < 0 or fat_g < 0:
        raise ValueError("Macro grams can't be negative.")
    implied = protein_g * 4 + carbs_g * 4 + fat_g * 9
    lower = target_calories * (1 - MACRO_CALORIE_TOLERANCE_PCT)
    upper = target_calories * (1 + MACRO_CALORIE_TOLERANCE_PCT)
    if not (lower <= implied <= upper):
        diff = round(implied - target_calories)
        if diff > 0:
            verb, amount = "reduce", diff
        else:
            verb, amount = "increase", -diff
        raise ValueError(
            f"These macros imply {round(implied)} kcal, which is {abs(diff)} kcal "
            f"{'over' if diff > 0 else 'under'} your {target_calories} kcal target. "
            f"Try adjusting protein/carbs/fat to {verb} the total by about {amount} kcal, "
            "or change your calorie target instead."
        )


def calculate_macro_targets(
    weight_kg: float,
    height_cm: float,
    age_years: int,
    sex: BiologicalSex,
    activity_level: ActivityLevel,
    goal: Goal,
    rate_kg_per_week: float | None = None,
) -> MacroTargets:
    """Full pipeline: BMR -> TDEE -> goal/rate-adjusted calories -> macro
    split."""
    recommended = calculate_recommended_calories(
        weight_kg, height_cm, age_years, sex, activity_level, goal, rate_kg_per_week
    )
    return macros_for_calories(recommended.calories, weight_kg, goal)


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

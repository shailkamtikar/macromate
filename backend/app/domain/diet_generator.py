"""AI diet-plan generation. Gemini proposes meal ideas and content; the
calorie/macro envelope they must fit inside always comes from the
deterministic macro-target engine (app/domain/macros.py), never from the
model. The model's own arithmetic is validated, not trusted blindly."""

import json
import re
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from app.domain.macros import MacroTargets

DietaryMode = str  # "vegetarian" | "non_vegetarian" | "egg_inclusive"

_DIETARY_MODE_RULES = {
    "vegetarian": "Strictly vegetarian: no meat, poultry, fish, or eggs.",
    "egg_inclusive": "Vegetarian plus eggs allowed: no meat, poultry, or fish, but eggs are fine.",
    "non_vegetarian": "No dietary restriction — meat, fish, poultry, and eggs are all fine.",
}

DIET_SYSTEM_INSTRUCTION_TEMPLATE = """You are a nutrition planning assistant for the MacroMate app.

Generate a ONE-DAY meal plan (breakfast, lunch, dinner, and optionally one snack) that fits within these EXACT daily targets — you must not change these numbers, they come from the user's real profile:
- Calories: {calories} kcal
- Protein: {protein_g} g
- Carbs: {carbs_g} g
- Fat: {fat_g} g

Dietary constraint: {dietary_rule}

For each meal, give a short description and your best estimate of its calories/protein/carbs/fat. Your per-meal estimates should sum reasonably close to the daily targets above (within about 10%).

Respond with ONLY a JSON object, no markdown, no explanation, in this exact shape:
{{"meals": [{{"meal_type": "breakfast", "description": "...", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}}], "notes": "one short encouraging sentence, no medical claims"}}
"""


class GeneratedMeal(BaseModel):
    meal_type: str
    description: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class GeneratedDietPlan(BaseModel):
    meals: list[GeneratedMeal]
    notes: str


@dataclass(frozen=True)
class DietPlanValidation:
    plan: GeneratedDietPlan
    total_calories: float
    total_protein_g: float
    total_carbs_g: float
    total_fat_g: float
    within_tolerance: bool


def dietary_rule_text(mode: DietaryMode) -> str:
    return _DIETARY_MODE_RULES.get(mode, _DIETARY_MODE_RULES["non_vegetarian"])


def build_system_instruction(targets: MacroTargets, mode: DietaryMode) -> str:
    return DIET_SYSTEM_INSTRUCTION_TEMPLATE.format(
        calories=targets.calories,
        protein_g=targets.protein_g,
        carbs_g=targets.carbs_g,
        fat_g=targets.fat_g,
        dietary_rule=dietary_rule_text(mode),
    )


def _strip_markdown_fence(text: str) -> str:
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    return match.group(1) if match else text


def parse_and_validate_plan(
    raw_response: str, targets: MacroTargets, tolerance: float = 0.20
) -> DietPlanValidation:
    """Parses Gemini's JSON and checks its own stated totals against the
    real target within a tolerance — this is a validation/consistency
    check on generated content, not a source of nutrition truth itself."""
    cleaned = _strip_markdown_fence(raw_response).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Gemini did not return valid JSON: {exc}") from exc

    try:
        plan = GeneratedDietPlan(**data)
    except ValidationError as exc:
        raise ValueError(f"Malformed diet plan: {exc}") from exc

    if not plan.meals:
        raise ValueError("Generated plan has no meals")

    total_calories = sum(m.calories for m in plan.meals)
    total_protein = sum(m.protein_g for m in plan.meals)
    total_carbs = sum(m.carbs_g for m in plan.meals)
    total_fat = sum(m.fat_g for m in plan.meals)

    within_tolerance = abs(total_calories - targets.calories) <= targets.calories * tolerance

    return DietPlanValidation(
        plan=plan,
        total_calories=total_calories,
        total_protein_g=total_protein,
        total_carbs_g=total_carbs,
        total_fat_g=total_fat,
        within_tolerance=within_tolerance,
    )

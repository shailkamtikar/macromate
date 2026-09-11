"""AI Coach context assembly and deterministic fast-path answers.

Every number the coach ever states — in a fast-path answer or injected into
a Gemini prompt for phrasing — comes from this module's deterministic
calculations, never from the model itself.
"""

import re
from dataclasses import dataclass, field

from app.domain.macros import (
    BiologicalSex,
    Goal,
    MacroTargets,
    RemainingMacros,
    bmi_category,
    calculate_bmi,
    calculate_remaining_macros,
)


@dataclass(frozen=True)
class CoachContext:
    bmi: float
    bmi_category: str
    goal: str
    target: MacroTargets
    remaining: RemainingMacros
    recent_weights_kg: list[float]
    # All optional/bounded additions kept deliberately small (a handful of
    # short lines, not full history) so the injected context stays cheap —
    # see context_to_prompt_text, which omits any of these that weren't
    # supplied rather than printing an empty/placeholder line.
    hydration_ml: float | None = None
    hydration_goal_ml: float | None = None
    logged_food_names: list[str] = field(default_factory=list)
    weekly_summary: str | None = None
    activity_steps_today: int | None = None


def build_context(
    *,
    weight_kg: float,
    height_cm: float,
    sex: BiologicalSex,
    goal: Goal,
    target: MacroTargets,
    consumed_calories: float,
    consumed_protein_g: float,
    consumed_carbs_g: float,
    consumed_fat_g: float,
    recent_weights_kg: list[float],
    hydration_ml: float | None = None,
    hydration_goal_ml: float | None = None,
    logged_food_names: list[str] | None = None,
    weekly_summary: str | None = None,
    activity_steps_today: int | None = None,
) -> CoachContext:
    bmi = calculate_bmi(weight_kg, height_cm)
    remaining = calculate_remaining_macros(
        target,
        consumed_calories=round(consumed_calories),
        consumed_protein_g=round(consumed_protein_g),
        consumed_carbs_g=round(consumed_carbs_g),
        consumed_fat_g=round(consumed_fat_g),
    )
    return CoachContext(
        bmi=bmi,
        bmi_category=bmi_category(bmi),
        goal=goal.value if hasattr(goal, "value") else str(goal),
        target=target,
        remaining=remaining,
        recent_weights_kg=recent_weights_kg,
        hydration_ml=hydration_ml,
        hydration_goal_ml=hydration_goal_ml,
        logged_food_names=logged_food_names or [],
        weekly_summary=weekly_summary,
        activity_steps_today=activity_steps_today,
    )


def context_to_prompt_text(ctx: CoachContext) -> str:
    trend = (
        " -> ".join(f"{w:.1f}kg" for w in ctx.recent_weights_kg)
        if ctx.recent_weights_kg
        else "no recent weight logs"
    )
    lines = [
        f"- Goal: {ctx.goal}\n",
        f"- BMI: {ctx.bmi} ({ctx.bmi_category})\n",
        f"- Daily target: {ctx.target.calories} kcal, "
        f"{ctx.target.protein_g}g protein, {ctx.target.carbs_g}g carbs, {ctx.target.fat_g}g fat\n",
        f"- Remaining today: {ctx.remaining.calories} kcal, "
        f"{ctx.remaining.protein_g}g protein, {ctx.remaining.carbs_g}g carbs, {ctx.remaining.fat_g}g fat\n",
        f"- Recent weight trend: {trend}\n",
    ]
    if ctx.hydration_goal_ml:
        lines.append(
            f"- Hydration today: {round(ctx.hydration_ml or 0)}/{round(ctx.hydration_goal_ml)} ml\n"
        )
    if ctx.logged_food_names:
        lines.append(f"- Logged today: {', '.join(ctx.logged_food_names)}\n")
    if ctx.weekly_summary:
        lines.append(f"- {ctx.weekly_summary}\n")
    if ctx.activity_steps_today is not None:
        lines.append(f"- Activity today: {ctx.activity_steps_today} steps\n")
    return "".join(lines)


_PROTEIN_LEFT_RE = re.compile(r"protein.*(left|remain)", re.IGNORECASE)
_BMI_RE = re.compile(r"\bbmi\b", re.IGNORECASE)
_MAINTENANCE_RE = re.compile(r"maintenance calor", re.IGNORECASE)
_CALORIES_LEFT_RE = re.compile(r"(calor|kcal).*(left|remain)", re.IGNORECASE)


def deterministic_fast_path(message: str, ctx: CoachContext) -> str | None:
    """Answers the most literal single-fact questions directly from the
    computed context, with zero Gemini call — saves quota for questions
    that genuinely need language understanding (PRD: don't unnecessarily
    call Gemini; use deterministic logic whenever the answer is a
    calculation)."""
    if _PROTEIN_LEFT_RE.search(message):
        return f"You have {ctx.remaining.protein_g}g of protein left to hit your {ctx.target.protein_g}g target today."
    if _BMI_RE.search(message):
        return f"Your BMI is {ctx.bmi}, which is in the {ctx.bmi_category} range."
    if _MAINTENANCE_RE.search(message):
        return f"Your current daily target is {ctx.target.calories} kcal, based on your goal ({ctx.goal})."
    if _CALORIES_LEFT_RE.search(message):
        return f"You have {ctx.remaining.calories} kcal left today, out of your {ctx.target.calories} kcal target."
    return None

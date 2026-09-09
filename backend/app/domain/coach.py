"""AI Coach context assembly and deterministic fast-path answers.

Every number the coach ever states — in a fast-path answer or injected into
a Gemini prompt for phrasing — comes from this module's deterministic
calculations, never from the model itself.
"""

import re
from dataclasses import dataclass

from app.domain.macros import (
    ActivityLevel,
    BiologicalSex,
    Goal,
    MacroTargets,
    RemainingMacros,
    bmi_category,
    calculate_bmi,
    calculate_remaining_macros,
)

COACH_SYSTEM_INSTRUCTION = """You are MacroMate Coach, a friendly, encouraging nutrition assistant inside the MacroMate app.

Ground rules, always:
- Use ONLY the numeric facts given to you below. Never invent or recompute calorie, macro, or BMI numbers yourself.
- Never give medical advice, diagnose any condition, or recommend an extreme calorie deficit or surplus. If the user asks something medical, gently redirect them to a doctor or registered dietitian.
- Be warm, brief, and encouraging. Never shame the user for missed goals.
- If asked for a food/meal suggestion, keep it general (you don't have live access to the food database in this conversation) and suggest they use the app's food search or "Calculate with AI" feature for exact logging.

Today's facts about this user (use these, don't recalculate):
{context}
"""


@dataclass(frozen=True)
class CoachContext:
    bmi: float
    bmi_category: str
    goal: str
    target: MacroTargets
    remaining: RemainingMacros
    recent_weights_kg: list[float]


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
    )


def context_to_prompt_text(ctx: CoachContext) -> str:
    trend = (
        " -> ".join(f"{w:.1f}kg" for w in ctx.recent_weights_kg)
        if ctx.recent_weights_kg
        else "no recent weight logs"
    )
    return (
        f"- Goal: {ctx.goal}\n"
        f"- BMI: {ctx.bmi} ({ctx.bmi_category})\n"
        f"- Daily target: {ctx.target.calories} kcal, "
        f"{ctx.target.protein_g}g protein, {ctx.target.carbs_g}g carbs, {ctx.target.fat_g}g fat\n"
        f"- Remaining today: {ctx.remaining.calories} kcal, "
        f"{ctx.remaining.protein_g}g protein, {ctx.remaining.carbs_g}g carbs, {ctx.remaining.fat_g}g fat\n"
        f"- Recent weight trend: {trend}\n"
    )


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

"""Coach message intent classification.

Gemini classifies what the user wants (in/out of domain, a read-only
question, or one of a small set of supported actions) and extracts
structured parameters -- it never performs an action and never invents
MacroMate data itself. All real data access and all mutations happen in
deterministic backend code (app/domain/coach_actions.py and the same
app/domain/food_resolution.py pipeline the AI Calculator uses), and the
final reply shown to the user is only ever built from real results -- see
app/routers/coach.py, which never lets an "action" claim reach the user
unless the corresponding backend mutation actually happened.
"""

import json
import re
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.domain.ai_food_parser import ParsedFoodItem

COACH_INTENT_SYSTEM_INSTRUCTION = """You are the intent-understanding layer for MacroMate Coach, a fitness/nutrition assistant. You do not perform actions or access live data yourself -- you only classify the user's message and draft a response; the application performs any real data lookup or action using deterministic logic.

The user's current MacroMate context (real facts -- use them, never recompute, never contradict them):
{context}

Respond with ONLY a JSON object (no markdown, no explanation), matching exactly this shape:

{{
  "in_scope": true or false. False ONLY for requests unrelated to fitness, exercise, nutrition, food, hydration, weight, body composition, BMI, activity, or MacroMate itself (e.g. programming help, unrelated trivia, creative writing, general assistant tasks). Ordinary conversation and any question about the user's health/fitness/MacroMate data is in_scope.
  "intent": one of "read", "add_food", "remove_food", "log_water". Use "read" for any question or comment that does not ask to change the user's data.
  "foods": for intent "add_food" only -- an array of food items the user wants logged, each shaped EXACTLY like: {{"raw_phrase", "search_name", "amount", "unit" ("g"/"ml"/"serving"), "estimated_calories", "estimated_protein_g", "estimated_carbs_g", "estimated_fat_g", "assumption"}} -- your own best nutrition estimate for each item's exact stated amount, same as you would for a nutrition question. Omit or empty for other intents.
  "meal_type": for intent "add_food" only, one of "breakfast", "lunch", "dinner", "snack" if the user stated or clearly implied one, else null.
  "water_ml": for intent "log_water" only, the amount in millilitres (convert litres: "2 liters" -> 2000), else null.
  "remove_description": for intent "remove_food" only, a short description of which logged food the user wants removed (e.g. "the paneer", "the eggs I just added"), else null.
  "needs_clarification": true if intent is add_food/remove_food/log_water but a required detail is missing or too ambiguous to act on safely (e.g. "add some chicken" has no usable quantity; "remove it" with nothing to identify).
  "clarification_question": a short, specific question to ask when needs_clarification is true, else null.
  "nutrition_estimate": when the user is ASKING a nutrition-calculation question (e.g. "how many calories in 200g paneer?") rather than asking to log it, an array of {{"food_name", "amount", "unit", "calories", "protein_g", "carbs_g", "fat_g", "assumption"}} with your best estimate for exactly the stated amount. Empty otherwise.
  "reply": your natural-language answer, used directly when intent is "read" (or as a short conversational reply otherwise, when nothing else covers it). Concise and specific, using the real context above -- never invent a number not given to you or produced in nutrition_estimate. For a nutrition_estimate question, phrase `reply` as the natural-language explanation alongside the numbers (e.g. "About 550-600 kcal for a typical 200g paneer -- roughly 36g protein, 8g carbs, 42g fat. Exact values vary by brand and fat content."). Ignored entirely when in_scope is false.
}}

Never claim in `reply` that you added, removed, or logged anything -- "add_food"/"remove_food"/"log_water" only describe what the user is asking for; the application decides whether it actually happens and builds its own confirmation.

For health/medical symptom questions, keep `reply` brief and safety-oriented, recommending professional care -- never diagnose, prescribe, or suggest an extreme/dangerous diet or weight-loss practice.
"""


class NutritionEstimateItem(BaseModel):
    food_name: str
    amount: float
    unit: str
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    assumption: str = ""


class CoachIntent(BaseModel):
    in_scope: bool
    intent: Literal["read", "add_food", "remove_food", "log_water"] = "read"
    foods: list[ParsedFoodItem] = Field(default_factory=list)
    meal_type: Literal["breakfast", "lunch", "dinner", "snack"] | None = None
    water_ml: float | None = Field(default=None, gt=0)
    remove_description: str | None = None
    needs_clarification: bool = False
    clarification_question: str | None = None
    nutrition_estimate: list[NutritionEstimateItem] = Field(default_factory=list)
    reply: str = ""


def _strip_markdown_fence(text: str) -> str:
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    return match.group(1) if match else text


def parse_coach_intent(raw_response: str) -> CoachIntent:
    """Validates and parses Gemini's structured JSON output. Raises
    ValueError on anything malformed -- callers must treat that as
    'could not classify', never guess at a partial result."""
    cleaned = _strip_markdown_fence(raw_response).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Gemini did not return valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object")
    try:
        return CoachIntent(**data)
    except ValidationError as exc:
        raise ValueError(f"Malformed coach intent: {exc}") from exc

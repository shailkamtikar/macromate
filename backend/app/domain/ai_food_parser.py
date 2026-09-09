"""Natural-language food-list parsing: Gemini is used only for (a) splitting
free text into distinct food items and (b) estimating how many standard
servings each item represents ("200g paneer" ≈ 2x a ~100g serving) — a
language/world-knowledge task, not arithmetic. Every calorie/macro number
that ultimately reaches the user comes from a real food_items row via
app/domain/food.compute_nutrition_snapshot, scaled by that multiplier.
Gemini never emits a nutrition number itself; its JSON output is validated
and any item it can't confidently split is simply excluded, not guessed at.
"""

import json
import re

from pydantic import BaseModel, ValidationError

PARSE_SYSTEM_INSTRUCTION = """You split a natural-language food-log sentence into individual food items.

For each distinct food mentioned, output:
- "raw_phrase": the exact phrase describing that food and its quantity, as written
- "search_name": a short, generic name for the food suitable for a database search (e.g. "paneer", "roti", "basmati rice") — no quantity/brand words
- "quantity_multiplier": a number estimating how many STANDARD servings of that food this represents, using your general knowledge of typical serving sizes (e.g. "200g paneer" is roughly 2x a normal ~100g paneer serving -> 2.0; "1 roti" -> 1.0; "1 cup rice" -> 1.0). Always a positive number.

Respond with ONLY a JSON array, no markdown, no explanation. Example:
[{"raw_phrase": "200g paneer", "search_name": "paneer", "quantity_multiplier": 2.0}, {"raw_phrase": "1 roti", "search_name": "roti", "quantity_multiplier": 1.0}]

If the input contains no identifiable food, respond with [].
"""


class ParsedFoodItem(BaseModel):
    raw_phrase: str
    search_name: str
    quantity_multiplier: float


def _strip_markdown_fence(text: str) -> str:
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    return match.group(1) if match else text


def parse_gemini_food_list(raw_response: str) -> list[ParsedFoodItem]:
    """Validates and parses Gemini's JSON output. Raises ValueError on
    anything malformed — callers must treat that as 'could not parse',
    never guess at a partial result."""
    cleaned = _strip_markdown_fence(raw_response).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Gemini did not return valid JSON: {exc}") from exc

    if not isinstance(data, list):
        raise ValueError("Expected a JSON array")

    items = []
    for entry in data:
        try:
            item = ParsedFoodItem(**entry)
        except ValidationError as exc:
            raise ValueError(f"Malformed item in Gemini response: {exc}") from exc
        if item.quantity_multiplier <= 0:
            raise ValueError("quantity_multiplier must be positive")
        items.append(item)
    return items

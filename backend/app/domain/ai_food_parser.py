"""Natural-language food-list parsing: Gemini is used only for (a) splitting
free text into distinct food items, (b) extracting the literal quantity and
unit as stated ("200g paneer" -> amount=200, unit="g"; "2 eggs" -> amount=2,
unit="serving") -- a language task, not arithmetic or world knowledge about
serving sizes -- and (c) giving its own best-effort nutrition ESTIMATE for
that exact stated amount, used only as a fallback when no real food_items
row can be confidently matched (see app/domain/food_resolution.py, the
single place that decides database-vs-estimate and does the actual
quantity/nutrition arithmetic either way). Gemini's estimate is never
treated as verified, never silently presented as database nutrition, and
never invents a database food ID -- see app/domain/food_resolution.py's
docstring for the full resolution policy.
"""

import json
import re

from pydantic import BaseModel, Field, ValidationError, field_validator

PARSE_SYSTEM_INSTRUCTION = """You split a natural-language food question or food-log sentence into individual food items.

For each distinct food mentioned, output:
- "raw_phrase": the exact phrase describing that food and its quantity, as written
- "search_name": the food's name, suitable for a database search -- strip quantity, brand, and filler words ("some", "a", "of"), but KEEP every word that distinguishes the food itself (e.g. "lentil dal" must stay "lentil dal", not collapse to just "dal"; "paneer curry" must stay "paneer curry", not just "curry" or "paneer"; "basmati rice" not just "rice"). Only use a single generic word when the phrase itself was that generic (e.g. "rice" for a plain "rice").
- "amount": the literal numeric quantity stated or clearly implied (e.g. "200g" -> 200, "2 eggs" -> 2, "1 cup rice" -> 1, "half a banana" -> 0.5, "a bowl of dal" -> 1, "1.5 cups" -> 1.5). Always a positive number.
- "unit": one of "g", "ml", or "serving" -- use "g" only when the amount is an explicit gram weight, "ml" only when it's an explicit millilitre volume, and "serving" for everything else (counts, cups, bowls, rotis, servings, or an unquantified mention of a food).
- "estimated_calories", "estimated_protein_g", "estimated_carbs_g", "estimated_fat_g": your own best nutrition estimate for EXACTLY the stated amount, calculated directly for that amount (e.g. for "200g paneer" estimate the full 200g, not some smaller reference serving to be scaled later). Use your general nutrition knowledge. Always non-negative numbers, and always provide your best guess even if unsure -- never omit these.
- "assumption": a short note (under 140 characters) about what you assumed, ONLY when a meaningful assumption was necessary (e.g. "Assuming a standard ~50g roti." or "Values vary by fat content and brand."); use an empty string when there's nothing notable to caveat.

Do NOT estimate how many grams a serving/cup/bowl weighs for database-lookup purposes -- report the literal amount and unit exactly as stated. Your own nutrition estimate is separate and always for that literal stated amount directly.

Respond with ONLY a JSON array, no markdown, no explanation. Example:
[{"raw_phrase": "200g paneer", "search_name": "paneer", "amount": 200, "unit": "g", "estimated_calories": 550, "estimated_protein_g": 36, "estimated_carbs_g": 8, "estimated_fat_g": 42, "assumption": "Values vary by brand and fat content."}]

If the input contains no identifiable food, respond with [].
"""

_UNIT_ALIASES = {
    "g": "g",
    "gram": "g",
    "grams": "g",
    "gm": "g",
    "gms": "g",
    "ml": "ml",
    "millilitre": "ml",
    "millilitres": "ml",
    "milliliter": "ml",
    "milliliters": "ml",
}


class ParsedFoodItem(BaseModel):
    raw_phrase: str
    search_name: str
    amount: float = Field(gt=0)
    unit: str
    estimated_calories: float = Field(ge=0)
    estimated_protein_g: float = Field(ge=0)
    estimated_carbs_g: float = Field(ge=0)
    estimated_fat_g: float = Field(ge=0)
    assumption: str = ""

    @field_validator("unit", mode="before")
    @classmethod
    def _normalize_unit(cls, value: object) -> str:
        # Gemini occasionally spells a unit out ("grams") or gets the case
        # wrong -- normalize known spellings, and treat anything else
        # (including a genuinely unrecognized unit) as "serving" rather than
        # rejecting the whole item over a wording quirk.
        key = str(value).strip().lower()
        return _UNIT_ALIASES.get(key, "serving" if key not in ("g", "ml") else key)


def _strip_markdown_fence(text: str) -> str:
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    return match.group(1) if match else text


def parse_gemini_food_list(raw_response: str) -> list[ParsedFoodItem]:
    """Validates and parses Gemini's JSON output. Raises ValueError on
    anything malformed -- callers must treat that as 'could not parse',
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
        items.append(item)
    return items

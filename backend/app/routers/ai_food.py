from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.gemini import GeminiUnavailable, generate_text
from app.core.supabase_admin import SupabaseAdmin
from app.domain.ai_food_parser import PARSE_SYSTEM_INSTRUCTION, parse_gemini_food_list
from app.domain.food_resolution import FoodCandidate, ResolvedFoodItem, resolve_food_mention

router = APIRouter(prefix="/api/ai", tags=["ai"])


class CalculateFoodsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class FoodCandidateOut(BaseModel):
    food_item_id: str | None
    food_name: str
    serving_description: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    serving_weight: float | None = None
    serving_weight_unit: str | None = None


class ParsedItemOut(BaseModel):
    raw_phrase: str
    search_name: str
    # The literal quantity Gemini extracted from the text, before any
    # conversion -- e.g. amount=200, unit="g" for "200g paneer".
    amount: float
    unit: str
    resolved: bool
    ambiguous: bool = False
    # "database" for a real, matched food_items row; "ai_estimate" when no
    # confident match existed and Gemini's own estimate was used instead.
    # None only when `ambiguous` is true (nothing has been chosen yet).
    source: str | None = None
    # True only when a weight/volume amount couldn't be converted against
    # the matched food's real serving metadata, so `quantity` fell back to
    # a single default serving the user should check before saving.
    quantity_is_assumption: bool = False
    food_item_id: str | None = None
    food_name: str | None = None
    serving_description: str | None = None
    serving_weight: float | None = None
    serving_weight_unit: str | None = None
    # The actual multiplier applied -- what would be stored as a
    # food_logs.quantity if this item is logged as-is.
    quantity: float | None = None
    calories: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    # Gemini's own caveat about its estimate (only set for ai_estimate
    # items), e.g. "Values vary by brand and fat content."
    assumption: str | None = None
    # Populated only when `ambiguous` is true -- the plausible database
    # matches for the user to choose between.
    candidates: list[FoodCandidateOut] | None = None
    # Populated only when `ambiguous` is true -- a ready-to-use AI-estimate
    # fallback, so ambiguity never has to block the user from proceeding.
    estimate: FoodCandidateOut | None = None


class NutritionTotal(BaseModel):
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class CalculateFoodsResponse(BaseModel):
    items: list[ParsedItemOut]
    total: NutritionTotal


def _candidate_out(c: FoodCandidate) -> FoodCandidateOut:
    return FoodCandidateOut(
        food_item_id=c.food_item_id,
        food_name=c.food_name,
        serving_description=c.serving_description,
        calories=c.calories,
        protein_g=c.protein_g,
        carbs_g=c.carbs_g,
        fat_g=c.fat_g,
        serving_weight=c.serving_weight,
        serving_weight_unit=c.serving_weight_unit,
    )


def _item_out(r: ResolvedFoodItem) -> ParsedItemOut:
    return ParsedItemOut(
        raw_phrase=r.raw_phrase,
        search_name=r.search_name,
        amount=r.amount,
        unit=r.unit,
        resolved=r.resolved,
        ambiguous=r.ambiguous,
        source=r.source,
        quantity_is_assumption=r.quantity_is_assumption,
        food_item_id=r.food_item_id,
        food_name=r.food_name,
        serving_description=r.serving_description,
        serving_weight=r.serving_weight,
        serving_weight_unit=r.serving_weight_unit,
        quantity=r.quantity,
        calories=r.calories,
        protein_g=r.protein_g,
        carbs_g=r.carbs_g,
        fat_g=r.fat_g,
        assumption=r.assumption,
        candidates=[_candidate_out(c) for c in r.candidates] if r.candidates else None,
        estimate=_candidate_out(r.estimate) if r.estimate else None,
    )


@router.post("/calculate-foods", response_model=CalculateFoodsResponse)
def calculate_foods(
    payload: CalculateFoodsRequest, current_user: CurrentUserDep
) -> CalculateFoodsResponse:
    try:
        raw_response = generate_text(
            payload.text, system_instruction=PARSE_SYSTEM_INSTRUCTION, timeout=20
        )
    except GeminiUnavailable as exc:
        raise HTTPException(
            status_code=503, detail=f"AI food parsing is temporarily unavailable: {exc}"
        )

    try:
        parsed = parse_gemini_food_list(raw_response)
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not interpret the AI response: {exc}"
        )

    db = SupabaseAdmin()
    items: list[ParsedItemOut] = []
    total = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}

    for parsed_item in parsed:
        # The interactive review UI can show a "which did you mean?"
        # chooser, so ambiguous database matches are surfaced as such
        # rather than auto-falling-back to the estimate.
        resolved = resolve_food_mention(
            db, parsed_item, user_id=current_user.user_id, treat_ambiguous_as_estimate=False
        )
        if resolved.resolved and resolved.source is not None:
            total["calories"] += resolved.calories or 0
            total["protein_g"] += resolved.protein_g or 0
            total["carbs_g"] += resolved.carbs_g or 0
            total["fat_g"] += resolved.fat_g or 0
        items.append(_item_out(resolved))

    return CalculateFoodsResponse(items=items, total=NutritionTotal(**total))

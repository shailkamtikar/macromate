from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.gemini import GeminiUnavailable, generate_text
from app.core.supabase_admin import SupabaseAdmin
from app.domain.ai_food_parser import PARSE_SYSTEM_INSTRUCTION, parse_gemini_food_list
from app.domain.food import compute_nutrition_snapshot

router = APIRouter(prefix="/api/ai", tags=["ai"])

# Below this trigram similarity, a search hit is treated as "not confident
# enough" and the item is surfaced to the user as unresolved rather than
# silently matched to an unrelated food.
MATCH_CONFIDENCE_THRESHOLD = 0.25


class CalculateFoodsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class ParsedItemOut(BaseModel):
    raw_phrase: str
    resolved: bool
    food_item_id: str | None = None
    food_name: str | None = None
    quantity_multiplier: float
    calories: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None


class NutritionTotal(BaseModel):
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class CalculateFoodsResponse(BaseModel):
    items: list[ParsedItemOut]
    total: NutritionTotal


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
        candidates = db.rpc(
            "search_food_items", {"search": parsed_item.search_name, "match_limit": 1}
        )
        best = candidates[0] if candidates else None

        if not best or best.get("similarity", 0) < MATCH_CONFIDENCE_THRESHOLD:
            items.append(
                ParsedItemOut(
                    raw_phrase=parsed_item.raw_phrase,
                    resolved=False,
                    quantity_multiplier=parsed_item.quantity_multiplier,
                )
            )
            continue

        snapshot = compute_nutrition_snapshot(
            calories_per_serving=best["calories"],
            protein_g_per_serving=best["protein_g"],
            carbs_g_per_serving=best["carbs_g"],
            fat_g_per_serving=best["fat_g"],
            quantity=parsed_item.quantity_multiplier,
        )
        total["calories"] += snapshot.calories
        total["protein_g"] += snapshot.protein_g
        total["carbs_g"] += snapshot.carbs_g
        total["fat_g"] += snapshot.fat_g

        items.append(
            ParsedItemOut(
                raw_phrase=parsed_item.raw_phrase,
                resolved=True,
                food_item_id=best["id"],
                food_name=best["name"],
                quantity_multiplier=parsed_item.quantity_multiplier,
                calories=snapshot.calories,
                protein_g=snapshot.protein_g,
                carbs_g=snapshot.carbs_g,
                fat_g=snapshot.fat_g,
            )
        )

    return CalculateFoodsResponse(items=items, total=NutritionTotal(**total))

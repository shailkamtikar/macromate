"""Shared deterministic food-item resolution.

There are exactly two nutrition sources a parsed food mention can resolve
to, decided here and only here, so the AI Calculator (app/routers/ai_food.py)
and the Coach's add-food action (app/domain/coach_actions.py) can never
drift into different nutrition math for the same kind of input:

  A. DATABASE -- a real food_items row (verified or user-custom) matched
     with high confidence. Nutrition and quantity are computed exactly as
     the rest of the app already does (app/domain/food.py), scaled by the
     food's own real serving metadata.

  B. AI ESTIMATE -- used only when no single database match is confident
     enough. Gemini's own estimate (already produced alongside the parse,
     see app/domain/ai_food_parser.py) is used directly for the stated
     amount -- never silently presented as database-verified, never
     assigned a database food ID.

A third, transient state -- AMBIGUOUS -- surfaces when multiple database
candidates are too close in similarity to pick automatically; callers
decide how to handle that (the Calculator shows a chooser to the user, the
Coach's action executor prefers the AI estimate over guessing which one is
right, since it can't hold an interactive disambiguation mid-chat).
"""

from dataclasses import dataclass, field

from app.core.supabase_admin import SupabaseAdmin
from app.domain.ai_food_parser import ParsedFoodItem
from app.domain.food import compute_nutrition_snapshot, parse_serving_weight

# Below this trigram similarity, a search hit is treated as "not confident
# enough" and the item falls back to the AI estimate rather than being
# silently matched to an unrelated food.
MATCH_CONFIDENCE_THRESHOLD = 0.25

# When the best and second-best candidates are this close in similarity,
# the top match isn't a clear enough winner to auto-select.
AMBIGUITY_SIMILARITY_MARGIN = 0.1

MAX_CANDIDATES = 5


@dataclass(frozen=True)
class FoodCandidate:
    food_item_id: str | None
    food_name: str
    serving_description: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    serving_weight: float | None = None
    serving_weight_unit: str | None = None


@dataclass(frozen=True)
class ResolvedFoodItem:
    raw_phrase: str
    search_name: str
    amount: float
    unit: str
    resolved: bool
    ambiguous: bool = False
    source: str | None = None  # "database" | "ai_estimate" | None
    quantity_is_assumption: bool = False
    food_item_id: str | None = None
    food_name: str | None = None
    serving_description: str | None = None
    serving_weight: float | None = None
    serving_weight_unit: str | None = None
    quantity: float | None = None
    calories: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    assumption: str | None = None
    candidates: list[FoodCandidate] = field(default_factory=list)
    # A ready-to-use AI-estimate fallback, populated only when `ambiguous`
    # is true, so a caller that can't hold an interactive disambiguation
    # (the Coach) can fall back to it without a second resolution pass.
    estimate: FoodCandidate | None = None


def _resolve_quantity(
    amount: float, unit: str, serving_description: str | None
) -> tuple[float, bool]:
    """Converts a parsed literal amount+unit into the servings quantity the
    food log actually stores, using only the matched food's own real
    serving metadata -- never a guessed gram-per-serving ratio. Returns
    (quantity, is_assumption); is_assumption is True only when the
    requested unit couldn't be deterministically converted (the matched
    food has no known weight, or it's in the other unit), so a single
    default serving was used as a placeholder the caller should flag for
    the user to confirm/edit.
    """
    if unit == "serving":
        return amount, False
    weight = parse_serving_weight(serving_description)
    if weight is not None and weight.unit == unit:
        return amount / weight.amount, False
    return 1.0, True


def _candidate_from_row(row: dict) -> FoodCandidate:
    weight = parse_serving_weight(row.get("serving_description"))
    return FoodCandidate(
        food_item_id=row["id"],
        food_name=row["name"],
        serving_description=row.get("serving_description") or "",
        calories=row["calories"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        serving_weight=weight.amount if weight else None,
        serving_weight_unit=weight.unit if weight else None,
    )


def _estimate_candidate(item: ParsedFoodItem) -> FoodCandidate:
    display_name = item.search_name.strip().title() or item.raw_phrase
    unit_label = "g" if item.unit == "g" else "ml" if item.unit == "ml" else "serving"
    return FoodCandidate(
        food_item_id=None,
        food_name=display_name,
        serving_description=f"{item.amount:g} {unit_label}",
        calories=item.estimated_calories,
        protein_g=item.estimated_protein_g,
        carbs_g=item.estimated_carbs_g,
        fat_g=item.estimated_fat_g,
    )


def resolve_food_mention(
    db: SupabaseAdmin,
    item: ParsedFoodItem,
    *,
    user_id: str,
    treat_ambiguous_as_estimate: bool = False,
) -> ResolvedFoodItem:
    """Resolves one parsed food mention against the real database, falling
    back to Gemini's own estimate (already computed alongside the parse)
    when there's no confident single match.

    `user_id` scopes the search so that, alongside every verified/global
    food, this user's own previously-accepted AI estimates are also
    reusable matches (found without a fresh Gemini call) -- while another
    user's accepted estimates never are (see search_food_items).

    `treat_ambiguous_as_estimate`: the Calculator's interactive review UI
    can show the user a "which did you mean?" chooser, so it wants
    ambiguous matches surfaced as such (default). The Coach's add-food
    action has no such UI mid-conversation, so it passes True to prefer a
    clearly-labeled estimate over silently guessing which candidate is
    right.
    """
    candidates = db.rpc(
        "search_food_items",
        {
            "search": item.search_name,
            "match_limit": MAX_CANDIDATES,
            "requesting_user_id": user_id,
        },
    )
    strong = [c for c in candidates if c.get("similarity", 0) >= MATCH_CONFIDENCE_THRESHOLD]
    ambiguous = len(strong) > 1 and (
        strong[0].get("similarity", 0) - strong[1].get("similarity", 0)
        < AMBIGUITY_SIMILARITY_MARGIN
    )

    if strong and not ambiguous:
        best = strong[0]
        quantity, is_assumption = _resolve_quantity(
            item.amount, item.unit, best.get("serving_description")
        )
        snapshot = compute_nutrition_snapshot(
            calories_per_serving=best["calories"],
            protein_g_per_serving=best["protein_g"],
            carbs_g_per_serving=best["carbs_g"],
            fat_g_per_serving=best["fat_g"],
            quantity=quantity,
        )
        weight = parse_serving_weight(best.get("serving_description"))
        # A match can be this user's own previously-accepted AI estimate
        # (reusable, see search_food_items) rather than a verified/custom
        # database food -- keep that provenance visible rather than
        # silently presenting reused AI nutrition as database-verified.
        matched_source = "ai_estimate" if best.get("is_ai_estimate") else "database"
        return ResolvedFoodItem(
            raw_phrase=item.raw_phrase,
            search_name=item.search_name,
            amount=item.amount,
            unit=item.unit,
            resolved=True,
            source=matched_source,
            quantity_is_assumption=is_assumption,
            food_item_id=best["id"],
            food_name=best["name"],
            serving_description=best.get("serving_description"),
            serving_weight=weight.amount if weight else None,
            serving_weight_unit=weight.unit if weight else None,
            quantity=quantity,
            calories=snapshot.calories,
            protein_g=snapshot.protein_g,
            carbs_g=snapshot.carbs_g,
            fat_g=snapshot.fat_g,
        )

    if ambiguous and not treat_ambiguous_as_estimate:
        return ResolvedFoodItem(
            raw_phrase=item.raw_phrase,
            search_name=item.search_name,
            amount=item.amount,
            unit=item.unit,
            resolved=False,
            ambiguous=True,
            candidates=[_candidate_from_row(c) for c in strong[:3]],
            estimate=_estimate_candidate(item),
        )

    # No confident single database match (or ambiguous but the caller can't
    # hold an interactive choice) -- the AI's own estimate, already computed
    # for exactly the stated amount, so this is never a dead end.
    estimate = _estimate_candidate(item)
    return ResolvedFoodItem(
        raw_phrase=item.raw_phrase,
        search_name=item.search_name,
        amount=item.amount,
        unit=item.unit,
        resolved=True,
        source="ai_estimate",
        quantity=item.amount,
        food_name=estimate.food_name,
        serving_description=estimate.serving_description,
        calories=estimate.calories,
        protein_g=estimate.protein_g,
        carbs_g=estimate.carbs_g,
        fat_g=estimate.fat_g,
        assumption=item.assumption or None,
    )


def get_or_create_personal_food(
    db: SupabaseAdmin,
    user_id: str,
    *,
    name: str,
    serving_description: str,
    calories: float,
    protein_g: float,
    carbs_g: float,
    fat_g: float,
) -> dict:
    """Accepting an AI estimate (Calculator "Add to diary" or a Coach
    add-food command) must create a reusable *personal* food_items row --
    but accepting the same one twice (e.g. logging "paneer" again later, or
    a duplicate Coach command) must reuse that row rather than creating a
    near-identical duplicate every time. Matching is case-insensitive on
    name, scoped to this user's own is_ai_estimate rows only -- never a
    verified/global food and never another user's estimate.

    Existing nutrition on a reused row is left untouched (the same food
    keeps the nutrition it was first accepted with); this only decides
    whether to insert a new row or reuse one, it never mutates one.
    """
    owned = db.select("food_items", {"created_by": f"eq.{user_id}", "select": "*"})
    needle = name.strip().lower()
    match = next(
        (
            row
            for row in owned
            if row.get("is_ai_estimate") and (row.get("name") or "").strip().lower() == needle
        ),
        None,
    )
    if match is not None:
        return match

    return db.insert(
        "food_items",
        {
            "name": name,
            "serving_description": serving_description,
            "calories": calories,
            "protein_g": protein_g,
            "carbs_g": carbs_g,
            "fat_g": fat_g,
            "verified": False,
            "is_ai_estimate": True,
            "created_by": user_id,
        },
    )[0]

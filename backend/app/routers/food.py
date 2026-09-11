from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin, SupabaseAdminError
from app.domain.food import (
    compute_nutrition_snapshot,
    likely_duplicates,
    parse_serving_weight,
)
from app.domain.food_resolution import get_or_create_personal_food
from app.domain.timeutil import day_bounds_utc, local_today

router = APIRouter(prefix="/api", tags=["food"])

MEAL_TYPE_PATTERN = "^(breakfast|lunch|dinner|snack)$"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class FoodItemOut(BaseModel):
    id: str
    name: str
    brand: str | None
    serving_description: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    verified: bool
    created_by: str | None
    # True for a personal food created from an accepted AI estimate (see
    # POST /api/food-logs with an ai_estimate payload) -- never verified,
    # never shared with other users, so the UI can keep its provenance
    # visible even when it's found again through ordinary search.
    is_ai_estimate: bool = False
    similarity: float | None = None
    # Derived from serving_description when it states an explicit weight, so
    # the client can offer "200 g" entry as well as "2 servings". None means
    # the food has no known per-serving weight — servings only.
    serving_weight: float | None = None
    serving_weight_unit: str | None = None
    # Only populated by the recent/frequent endpoint.
    log_count: int | None = None
    last_logged_at: str | None = None


def _food_item_out(row: dict, **extra) -> FoodItemOut:
    weight = parse_serving_weight(row.get("serving_description"))
    return FoodItemOut(
        **{k: row.get(k) for k in
           ("id", "name", "brand", "serving_description", "calories",
            "protein_g", "carbs_g", "fat_g", "verified", "created_by")},
        is_ai_estimate=bool(row.get("is_ai_estimate")),
        similarity=row.get("similarity"),
        serving_weight=weight.amount if weight else None,
        serving_weight_unit=weight.unit if weight else None,
        **extra,
    )


class FoodSearchResponse(BaseModel):
    results: list[FoodItemOut]


class RecentFoodsResponse(BaseModel):
    recent: list[FoodItemOut]
    frequent: list[FoodItemOut]


class CreateFoodRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    brand: str | None = None
    serving_description: str = Field(min_length=1, max_length=200)
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    fiber_g: float | None = Field(default=None, ge=0)
    sugar_g: float | None = Field(default=None, ge=0)
    sodium_mg: float | None = Field(default=None, ge=0)
    # If the caller already saw the duplicate warning and wants to proceed
    # anyway, they set this — otherwise a likely-duplicate match blocks
    # creation and returns the candidates for the client to choose from.
    force: bool = False


class CreateFoodResponse(BaseModel):
    created: FoodItemOut | None
    possible_duplicates: list[FoodItemOut]


class AiEstimateInput(BaseModel):
    """An AI-estimated food's nutrition per 1 unit of `quantity` below (the
    literal amount+unit the user reviewed, e.g. "per 1 g" for a 200g
    estimate logged at quantity=200) -- the same shape food_items already
    stores per-serving nutrition in, so the rest of the log-creation path
    (quantity scaling, immutable snapshot) is identical to a database log."""

    name: str = Field(min_length=1, max_length=200)
    serving_description: str = Field(min_length=1, max_length=200)
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)


class LogFoodRequest(BaseModel):
    food_item_id: str | None = None
    # Alternative to food_item_id: logs a Gemini-estimated food that had no
    # confident database match (PRD Phase 3 §5/§9). Exactly one of the two
    # must be provided.
    ai_estimate: AiEstimateInput | None = None
    meal_type: str = Field(pattern=MEAL_TYPE_PATTERN)
    quantity: float = Field(gt=0)

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "LogFoodRequest":
        if (self.food_item_id is None) == (self.ai_estimate is None):
            raise ValueError("Provide exactly one of food_item_id or ai_estimate.")
        return self


class UpdateFoodLogRequest(BaseModel):
    """Both fields are optional so the client can change the quantity, move
    the entry to a different meal, or do both in one request."""

    quantity: float | None = Field(default=None, gt=0)
    meal_type: str | None = Field(default=None, pattern=MEAL_TYPE_PATTERN)

    @model_validator(mode="after")
    def _at_least_one_change(self) -> "UpdateFoodLogRequest":
        if self.quantity is None and self.meal_type is None:
            raise ValueError("Provide quantity, meal_type, or both.")
        return self


class FoodLogOut(BaseModel):
    id: str
    food_item_id: str
    food_name: str
    meal_type: str
    quantity: float
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    logged_at: str
    # "database" for a real, verified/user-custom food_items row (the only
    # value that ever existed before Phase 3); "ai_estimate" when this log's
    # nutrition came from a Gemini estimate with no confident database
    # match, so the UI can keep that provenance visible rather than
    # presenting it as verified.
    source: str = "database"
    # Display metadata read from the food_items row (not from the log's
    # nutrition snapshot) so the diary can render "200 g" / "2 x 1 bowl"
    # and the edit UI can offer the same units. The authoritative nutrition
    # numbers still come from the log's own immutable snapshot.
    serving_description: str | None = None
    serving_weight: float | None = None
    serving_weight_unit: str | None = None


def _food_log_out(row: dict, food_item: dict | None) -> FoodLogOut:
    serving_description = (food_item or {}).get("serving_description")
    weight = parse_serving_weight(serving_description)
    return FoodLogOut(
        id=row["id"],
        food_item_id=row["food_item_id"],
        food_name=(food_item or {}).get("name") or "Unknown",
        meal_type=row["meal_type"],
        quantity=row["quantity"],
        calories=row["calories"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        logged_at=row["logged_at"],
        source=row.get("source") or "database",
        serving_description=serving_description,
        serving_weight=weight.amount if weight else None,
        serving_weight_unit=weight.unit if weight else None,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/foods/search", response_model=FoodSearchResponse)
def search_foods(
    current_user: CurrentUserDep,
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=10, ge=1, le=50),
) -> FoodSearchResponse:
    db = SupabaseAdmin()
    # Includes this user's own previously-accepted AI-estimate foods
    # alongside verified/global ones (never another user's) -- an accepted
    # estimate is a reusable personal food, not a one-time answer.
    rows = db.rpc(
        "search_food_items",
        {"search": q, "match_limit": limit, "requesting_user_id": current_user.user_id},
    )
    return FoodSearchResponse(results=[_food_item_out(r) for r in rows])


@router.get("/foods/recent", response_model=RecentFoodsResponse)
def recent_foods(
    current_user: CurrentUserDep,
    limit: int = Query(default=10, ge=1, le=50),
) -> RecentFoodsResponse:
    """The two lists a mature tracker leans on for fast repeat logging:
    what this user logged most recently, and what they log most often.
    Both are derived from their own real food_logs — no cross-user data,
    no invented "popular foods" list."""
    db = SupabaseAdmin()
    rows = db.select(
        "food_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "select": "food_item_id,logged_at,food_items(*)",
            "order": "logged_at.desc",
            # Bounded window: enough history for a meaningful frequency
            # signal without scanning a long-time user's entire diary.
            "limit": "300",
        },
    )

    seen: dict[str, dict] = {}
    for row in rows:
        food_item = row.get("food_items")
        if not food_item:
            continue
        entry = seen.get(row["food_item_id"])
        if entry is None:
            # Rows arrive newest-first, so the first sighting is the most
            # recent log of that food.
            seen[row["food_item_id"]] = {
                "item": food_item,
                "count": 1,
                "last_logged_at": row["logged_at"],
            }
        else:
            entry["count"] += 1

    entries = list(seen.values())
    recent = entries[:limit]  # already newest-first from the query order
    frequent = sorted(
        entries, key=lambda e: (e["count"], e["last_logged_at"]), reverse=True
    )[:limit]

    def to_out(entry: dict) -> FoodItemOut:
        return _food_item_out(
            entry["item"],
            log_count=entry["count"],
            last_logged_at=entry["last_logged_at"],
        )

    return RecentFoodsResponse(
        recent=[to_out(e) for e in recent],
        frequent=[to_out(e) for e in frequent],
    )


@router.post("/foods", response_model=CreateFoodResponse)
def create_food(
    payload: CreateFoodRequest, current_user: CurrentUserDep
) -> CreateFoodResponse:
    db = SupabaseAdmin()

    candidates = db.rpc(
        "search_food_items",
        {
            "search": payload.name,
            "match_limit": 5,
            "requesting_user_id": current_user.user_id,
        },
    )
    duplicates = likely_duplicates(candidates)

    if duplicates and not payload.force:
        return CreateFoodResponse(
            created=None,
            possible_duplicates=[_food_item_out(d) for d in duplicates],
        )

    row = db.insert(
        "food_items",
        {
            "name": payload.name,
            "brand": payload.brand,
            "serving_description": payload.serving_description,
            "calories": payload.calories,
            "protein_g": payload.protein_g,
            "carbs_g": payload.carbs_g,
            "fat_g": payload.fat_g,
            "fiber_g": payload.fiber_g,
            "sugar_g": payload.sugar_g,
            "sodium_mg": payload.sodium_mg,
            # Server-derived from the verified JWT — never trust a
            # client-supplied created_by.
            "created_by": current_user.user_id,
        },
    )[0]
    return CreateFoodResponse(created=_food_item_out(row), possible_duplicates=[])


@router.post("/food-logs", response_model=FoodLogOut)
def log_food(payload: LogFoodRequest, current_user: CurrentUserDep) -> FoodLogOut:
    db = SupabaseAdmin()

    if payload.ai_estimate is not None:
        # Back the log with a real food_items row so quantity-scaling and
        # the immutable-snapshot machinery below stay identical to every
        # other log -- flagged is_ai_estimate so it's excluded from shared
        # search/duplicate-detection for OTHER users (search_food_items)
        # and never confused for a verified/global food, but reusable by
        # this same user later (see get_or_create_personal_food) so the
        # same accepted estimate doesn't need Gemini, or a duplicate row,
        # every time it's logged again.
        food_item = get_or_create_personal_food(
            db,
            current_user.user_id,
            name=payload.ai_estimate.name,
            serving_description=payload.ai_estimate.serving_description,
            calories=payload.ai_estimate.calories,
            protein_g=payload.ai_estimate.protein_g,
            carbs_g=payload.ai_estimate.carbs_g,
            fat_g=payload.ai_estimate.fat_g,
        )
        source = "ai_estimate"
    else:
        matches = db.select(
            "food_items", {"id": f"eq.{payload.food_item_id}", "select": "*"}
        )
        if not matches:
            raise HTTPException(status_code=404, detail="Food item not found")
        food_item = matches[0]
        # A food_item_id can point at this user's own reused AI-estimate
        # food (found via ordinary search, not just the Calculator/Coach
        # flows) -- keep that provenance on the log rather than presenting
        # it as verified database nutrition just because it was logged
        # through the normal picker.
        source = "ai_estimate" if food_item.get("is_ai_estimate") else "database"

    snapshot = compute_nutrition_snapshot(
        calories_per_serving=food_item["calories"],
        protein_g_per_serving=food_item["protein_g"],
        carbs_g_per_serving=food_item["carbs_g"],
        fat_g_per_serving=food_item["fat_g"],
        quantity=payload.quantity,
    )

    row = db.insert(
        "food_logs",
        {
            # Server-derived, never trust a client-supplied user_id.
            "user_id": current_user.user_id,
            "food_item_id": food_item["id"],
            "meal_type": payload.meal_type,
            "quantity": payload.quantity,
            "calories": snapshot.calories,
            "protein_g": snapshot.protein_g,
            "carbs_g": snapshot.carbs_g,
            "fat_g": snapshot.fat_g,
            "source": source,
        },
    )[0]

    return _food_log_out(row, food_item)


@router.get("/food-logs", response_model=list[FoodLogOut])
def list_food_logs(
    current_user: CurrentUserDep,
    log_date: date | None = Query(default=None, alias="date"),
) -> list[FoodLogOut]:
    db = SupabaseAdmin()
    profiles = db.select(
        "profiles", {"id": f"eq.{current_user.user_id}", "select": "timezone"}
    )
    tz_name = profiles[0].get("timezone") if profiles else None

    # "date" is the user's local calendar date; convert to the UTC instants
    # that span it in their timezone, not the server's UTC day.
    day_start, day_end = day_bounds_utc(log_date or local_today(tz_name), tz_name)

    rows = db.select(
        "food_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
            "select": "*,food_items(name,serving_description)",
            "order": "logged_at.asc",
        },
    )

    return [_food_log_out(r, r.get("food_items")) for r in rows]


@router.patch("/food-logs/{log_id}", response_model=FoodLogOut)
def update_food_log(
    log_id: str, payload: UpdateFoodLogRequest, current_user: CurrentUserDep
) -> FoodLogOut:
    db = SupabaseAdmin()

    matches = db.select(
        "food_logs",
        {
            "id": f"eq.{log_id}",
            "user_id": f"eq.{current_user.user_id}",
            "select": "*,food_items(name,serving_description)",
        },
    )
    if not matches:
        raise HTTPException(status_code=404, detail="Food log not found")
    existing = matches[0]

    changes: dict = {}

    if payload.meal_type is not None:
        # Moving an entry between meals never touches its nutrition — the
        # same food in the same amount, just filed under a different meal.
        changes["meal_type"] = payload.meal_type

    if payload.quantity is not None:
        # Recompute from *this log's own* originally-logged per-serving basis
        # (its snapshot calories/protein/carbs/fat divided by its old
        # quantity) rather than re-reading food_items — a quantity edit is an
        # intentional user correction, but the per-serving nutrition it
        # scales must stay the one locked in at logging time, preserving the
        # immutable-snapshot guarantee even while the quantity changes.
        snapshot = compute_nutrition_snapshot(
            calories_per_serving=existing["calories"] / existing["quantity"],
            protein_g_per_serving=existing["protein_g"] / existing["quantity"],
            carbs_g_per_serving=existing["carbs_g"] / existing["quantity"],
            fat_g_per_serving=existing["fat_g"] / existing["quantity"],
            quantity=payload.quantity,
        )
        changes.update(
            quantity=payload.quantity,
            calories=snapshot.calories,
            protein_g=snapshot.protein_g,
            carbs_g=snapshot.carbs_g,
            fat_g=snapshot.fat_g,
        )

    row = db.update(
        "food_logs",
        {"id": f"eq.{log_id}", "user_id": f"eq.{current_user.user_id}"},
        changes,
    )[0]

    return _food_log_out(row, existing.get("food_items"))


@router.delete("/food-logs/{log_id}", status_code=204)
def delete_food_log(log_id: str, current_user: CurrentUserDep) -> None:
    db = SupabaseAdmin()
    # Scope by user_id too, not just id — never trust that a client-supplied
    # path id belongs to the caller. Verify existence/ownership first so a
    # foreign or already-deleted id gets a 404, not a silent no-op 204.
    matches = db.select(
        "food_logs",
        {"id": f"eq.{log_id}", "user_id": f"eq.{current_user.user_id}", "select": "id"},
    )
    if not matches:
        raise HTTPException(status_code=404, detail="Food log not found")
    db._request(
        "DELETE",
        "food_logs",
        params={"id": f"eq.{log_id}", "user_id": f"eq.{current_user.user_id}"},
    )

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin, SupabaseAdminError
from app.domain.food import compute_nutrition_snapshot, likely_duplicates
from app.domain.timeutil import day_bounds_utc, local_today

router = APIRouter(prefix="/api", tags=["food"])


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
    similarity: float | None = None


class FoodSearchResponse(BaseModel):
    results: list[FoodItemOut]


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


class LogFoodRequest(BaseModel):
    food_item_id: str
    meal_type: str = Field(pattern="^(breakfast|lunch|dinner|snack)$")
    quantity: float = Field(gt=0)


class UpdateFoodLogRequest(BaseModel):
    quantity: float = Field(gt=0)


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
    rows = db.rpc("search_food_items", {"search": q, "match_limit": limit})
    return FoodSearchResponse(results=[FoodItemOut(**r) for r in rows])


@router.post("/foods", response_model=CreateFoodResponse)
def create_food(
    payload: CreateFoodRequest, current_user: CurrentUserDep
) -> CreateFoodResponse:
    db = SupabaseAdmin()

    candidates = db.rpc("search_food_items", {"search": payload.name, "match_limit": 5})
    duplicates = likely_duplicates(candidates)

    if duplicates and not payload.force:
        return CreateFoodResponse(
            created=None,
            possible_duplicates=[FoodItemOut(**d) for d in duplicates],
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
    return CreateFoodResponse(created=FoodItemOut(**row), possible_duplicates=[])


@router.post("/food-logs", response_model=FoodLogOut)
def log_food(payload: LogFoodRequest, current_user: CurrentUserDep) -> FoodLogOut:
    db = SupabaseAdmin()

    matches = db.select(
        "food_items", {"id": f"eq.{payload.food_item_id}", "select": "*"}
    )
    if not matches:
        raise HTTPException(status_code=404, detail="Food item not found")
    food_item = matches[0]

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
            "food_item_id": payload.food_item_id,
            "meal_type": payload.meal_type,
            "quantity": payload.quantity,
            "calories": snapshot.calories,
            "protein_g": snapshot.protein_g,
            "carbs_g": snapshot.carbs_g,
            "fat_g": snapshot.fat_g,
        },
    )[0]

    return FoodLogOut(
        id=row["id"],
        food_item_id=row["food_item_id"],
        food_name=food_item["name"],
        meal_type=row["meal_type"],
        quantity=row["quantity"],
        calories=row["calories"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        logged_at=row["logged_at"],
    )


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
            "select": "*,food_items(name)",
            "order": "logged_at.asc",
        },
    )

    return [
        FoodLogOut(
            id=r["id"],
            food_item_id=r["food_item_id"],
            food_name=r["food_items"]["name"] if r.get("food_items") else "Unknown",
            meal_type=r["meal_type"],
            quantity=r["quantity"],
            calories=r["calories"],
            protein_g=r["protein_g"],
            carbs_g=r["carbs_g"],
            fat_g=r["fat_g"],
            logged_at=r["logged_at"],
        )
        for r in rows
    ]


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
            "select": "*,food_items(name)",
        },
    )
    if not matches:
        raise HTTPException(status_code=404, detail="Food log not found")
    existing = matches[0]

    # Recompute from *this log's own* originally-logged per-serving basis
    # (its snapshot calories/protein/carbs/fat divided by its old quantity)
    # rather than re-reading food_items — a quantity edit is an intentional
    # user correction, but the per-serving nutrition it scales must stay the
    # one locked in at logging time, preserving the immutable-snapshot
    # guarantee even while the logged quantity itself changes.
    snapshot = compute_nutrition_snapshot(
        calories_per_serving=existing["calories"] / existing["quantity"],
        protein_g_per_serving=existing["protein_g"] / existing["quantity"],
        carbs_g_per_serving=existing["carbs_g"] / existing["quantity"],
        fat_g_per_serving=existing["fat_g"] / existing["quantity"],
        quantity=payload.quantity,
    )

    row = db.update(
        "food_logs",
        {"id": f"eq.{log_id}", "user_id": f"eq.{current_user.user_id}"},
        {
            "quantity": payload.quantity,
            "calories": snapshot.calories,
            "protein_g": snapshot.protein_g,
            "carbs_g": snapshot.carbs_g,
            "fat_g": snapshot.fat_g,
        },
    )[0]

    return FoodLogOut(
        id=row["id"],
        food_item_id=row["food_item_id"],
        food_name=existing["food_items"]["name"] if existing.get("food_items") else "Unknown",
        meal_type=row["meal_type"],
        quantity=row["quantity"],
        calories=row["calories"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        logged_at=row["logged_at"],
    )


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

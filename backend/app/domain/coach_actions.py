"""Deterministic execution of Coach-requested actions.

Gemini (via app/domain/coach_intent.py) only classifies what the user wants
and extracts parameters -- every function here actually performs the
mutation, scoped to a single user_id, reusing the exact same domain logic
and data-access patterns as the regular authenticated routers (never a
separate, weaker code path). Callers (app/routers/coach.py) must only ever
tell the user an action happened after one of these functions reports
success.
"""

from dataclasses import dataclass

from app.core.supabase_admin import SupabaseAdmin
from app.domain.ai_food_parser import ParsedFoodItem
from app.domain.food import compute_nutrition_snapshot
from app.domain.food_resolution import get_or_create_personal_food, resolve_food_mention
from app.domain.timeutil import day_bounds_utc, local_today


@dataclass(frozen=True)
class LoggedFoodResult:
    food_name: str
    quantity: float
    calories: float
    source: str  # "database" | "ai_estimate"


@dataclass(frozen=True)
class AddFoodResult:
    meal_type: str
    logged: list[LoggedFoodResult]
    total_calories: float


def execute_add_food(
    db: SupabaseAdmin, user_id: str, foods: list[ParsedFoodItem], meal_type: str
) -> AddFoodResult:
    """Logs each food exactly like the AI Calculator's "Add to diary" would:
    a confident database match is used deterministically; anything without
    one falls back to Gemini's own estimate (already computed alongside
    the parse) rather than blocking the whole request. Ambiguous database
    matches are also treated as an estimate here -- the Coach has no
    interactive "which did you mean?" UI mid-conversation, so it prefers a
    clearly-labeled estimate over silently guessing which specific
    database entry is right."""
    logged: list[LoggedFoodResult] = []
    total_calories = 0.0

    for item in foods:
        resolved = resolve_food_mention(
            db, item, user_id=user_id, treat_ambiguous_as_estimate=True
        )
        if not resolved.resolved or not resolved.quantity or resolved.quantity <= 0:
            continue

        if resolved.source == "database":
            food_item_id = resolved.food_item_id
            source = "database"
        elif resolved.food_item_id is not None:
            # An AI-estimate match resolve_food_mention already found via
            # search (this user's own previously-accepted estimate) --
            # reuse it directly, no lookup or insert needed.
            food_item_id = resolved.food_item_id
            source = "ai_estimate"
        else:
            unit_basis = "g" if resolved.unit == "g" else "ml" if resolved.unit == "ml" else "serving"
            per_unit = compute_nutrition_snapshot(
                calories_per_serving=(resolved.calories or 0) / resolved.quantity,
                protein_g_per_serving=(resolved.protein_g or 0) / resolved.quantity,
                carbs_g_per_serving=(resolved.carbs_g or 0) / resolved.quantity,
                fat_g_per_serving=(resolved.fat_g or 0) / resolved.quantity,
                quantity=1,
            )
            # A fresh estimate, no existing match at all -- reuse this
            # user's own personal AI-estimate food for the same name if
            # they already have one, rather than creating a near-duplicate
            # row every time the same food is accepted again.
            new_food = get_or_create_personal_food(
                db,
                user_id,
                name=resolved.food_name or item.search_name.title(),
                serving_description=f"1 {unit_basis}",
                calories=per_unit.calories,
                protein_g=per_unit.protein_g,
                carbs_g=per_unit.carbs_g,
                fat_g=per_unit.fat_g,
            )
            food_item_id = new_food["id"]
            source = "ai_estimate"

        snapshot = compute_nutrition_snapshot(
            calories_per_serving=(resolved.calories or 0) / resolved.quantity,
            protein_g_per_serving=(resolved.protein_g or 0) / resolved.quantity,
            carbs_g_per_serving=(resolved.carbs_g or 0) / resolved.quantity,
            fat_g_per_serving=(resolved.fat_g or 0) / resolved.quantity,
            quantity=resolved.quantity,
        )
        db.insert(
            "food_logs",
            {
                "user_id": user_id,
                "food_item_id": food_item_id,
                "meal_type": meal_type,
                "quantity": resolved.quantity,
                "calories": snapshot.calories,
                "protein_g": snapshot.protein_g,
                "carbs_g": snapshot.carbs_g,
                "fat_g": snapshot.fat_g,
                "source": source,
            },
        )
        logged.append(
            LoggedFoodResult(
                food_name=resolved.food_name or item.search_name,
                quantity=resolved.quantity,
                calories=snapshot.calories,
                source=source,
            )
        )
        total_calories += snapshot.calories

    return AddFoodResult(meal_type=meal_type, logged=logged, total_calories=total_calories)


@dataclass(frozen=True)
class RemoveFoodResult:
    removed: bool
    food_name: str | None = None
    reason: str | None = None  # set when removed is False -- "not_found" | "ambiguous"


def execute_remove_food(db: SupabaseAdmin, user_id: str, description: str) -> RemoveFoodResult:
    """Removes a food logged earlier TODAY that matches `description` by
    name -- only when exactly one of today's logs plausibly matches.
    Never guesses between multiple candidates or reaches outside today's
    log, since an irreversible delete based on a loose text match is
    exactly the kind of "materially ambiguous" action the Coach must not
    silently resolve on its own."""
    profiles = db.select("profiles", {"id": f"eq.{user_id}", "select": "timezone"})
    tz_name = profiles[0].get("timezone") if profiles else None
    day_start, day_end = day_bounds_utc(local_today(tz_name), tz_name)

    rows = db.select(
        "food_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
            "select": "id,food_items(name)",
        },
    )

    needle = description.strip().lower()
    words = [w for w in needle.replace("the ", "").split() if len(w) > 2]
    matches = []
    for row in rows:
        name = ((row.get("food_items") or {}).get("name") or "").lower()
        if not name:
            continue
        if needle in name or name in needle or any(w in name for w in words):
            matches.append(row)

    if not matches:
        return RemoveFoodResult(removed=False, reason="not_found")
    if len(matches) > 1:
        return RemoveFoodResult(removed=False, reason="ambiguous")

    target = matches[0]
    db._request(
        "DELETE",
        "food_logs",
        params={"id": f"eq.{target['id']}", "user_id": f"eq.{user_id}"},
    )
    return RemoveFoodResult(removed=True, food_name=(target.get("food_items") or {}).get("name"))


@dataclass(frozen=True)
class LogWaterResult:
    total_ml: float


def execute_log_water(db: SupabaseAdmin, user_id: str, volume_ml: float) -> LogWaterResult:
    db.insert("water_logs", {"user_id": user_id, "volume_ml": volume_ml})
    profiles = db.select("profiles", {"id": f"eq.{user_id}", "select": "timezone"})
    tz_name = profiles[0].get("timezone") if profiles else None
    day_start, day_end = day_bounds_utc(local_today(tz_name), tz_name)
    rows = db.select(
        "water_logs",
        {
            "user_id": f"eq.{user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
        },
    )
    return LogWaterResult(total_ml=sum(r["volume_ml"] for r in rows))

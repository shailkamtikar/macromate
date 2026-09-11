from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.core.supabase_admin import SupabaseAdmin
from app.domain.macros import MacroTargets, calculate_remaining_macros
from app.domain.suggestions import SuggestionCandidate, rank_candidates
from app.domain.timeutil import day_bounds_utc, local_today

router = APIRouter(prefix="/api", tags=["suggestions"])

# A remaining protein gap only counts as "still worth prioritizing" when
# it's both a meaningful number of grams and a meaningful fraction of the
# day's target — otherwise a trivial few-gram shortfall would keep forcing
# protein-dense foods to the top of every suggestion list even after the
# user has effectively already hit their protein goal.
_PROTEIN_STILL_NEEDED_MIN_G = 10
_PROTEIN_STILL_NEEDED_FRACTION = 0.15

# How many candidates to pull from the shared/global eligible pool before
# ranking narrows it down -- generous enough that ranking has real choices,
# small enough to stay a cheap, bounded query.
_CANDIDATE_POOL_LIMIT = 20

# How many of the user's own recent/frequent foods to consider as
# personalized candidates. Deliberately small: this is a ranking signal
# ("a food they already actually eat"), not a full history dump.
_PERSONAL_HISTORY_LIMIT = 15

FINAL_SUGGESTION_LIMIT = 3


class SuggestedFood(BaseModel):
    id: str
    name: str
    brand: str | None
    serving_description: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    verified: bool


class SuggestionsResponse(BaseModel):
    message: str
    remaining_calories: int
    remaining_protein_g: int
    remaining_carbs_g: int
    remaining_fat_g: int
    # Whether these suggestions are currently ranked to close a real
    # protein gap — lets the UI say *why* it's showing what it's showing,
    # instead of always implying "you need more protein".
    protein_is_priority: bool
    suggestions: list[SuggestedFood]


def _to_candidate(row: dict, *, is_personal_history: bool) -> SuggestionCandidate:
    return SuggestionCandidate(
        id=row["id"],
        name=row["name"],
        brand=row.get("brand"),
        serving_description=row["serving_description"],
        calories=row["calories"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        verified=row["verified"],
        is_personal_history=is_personal_history,
    )


def _personal_history_candidates(db: SupabaseAdmin, user_id: str) -> list[SuggestionCandidate]:
    """A user's own recently/frequently logged foods, exactly like
    GET /api/foods/recent sources them: scoped strictly to their own
    food_logs, so this can never expose another user's private data
    (including another user's own personal AI-estimate foods) -- it only
    ever surfaces a food this same user has already logged themselves,
    regardless of that food_items row's own global verified/created_by
    classification. This is what lets a user's own previously-logged
    personal food (e.g. an accepted AI estimate, reusable by its owner)
    count as a suggestion for *them*, without loosening the shared/global
    eligibility pool used by everyone else."""
    rows = db.select(
        "food_logs",
        {
            "user_id": f"eq.{user_id}",
            "select": "food_item_id,food_items(*)",
            "order": "logged_at.desc",
            "limit": "300",
        },
    )
    seen: dict[str, dict] = {}
    for row in rows:
        food_item = row.get("food_items")
        if not food_item or row["food_item_id"] in seen:
            continue
        seen[row["food_item_id"]] = food_item
        if len(seen) >= _PERSONAL_HISTORY_LIMIT:
            break
    return [_to_candidate(item, is_personal_history=True) for item in seen.values()]


@router.get("/suggestions", response_model=SuggestionsResponse)
def get_suggestions(current_user: CurrentUserDep) -> SuggestionsResponse:
    db = SupabaseAdmin()

    profiles = db.select("profiles", {"id": f"eq.{current_user.user_id}", "select": "*"})
    profile = profiles[0] if profiles else None

    tz_name = (profile.get("timezone") if profile else None) or "UTC"
    today = local_today(tz_name)
    day_start, day_end = day_bounds_utc(today, tz_name)
    food_logs = db.select(
        "food_logs",
        {
            "user_id": f"eq.{current_user.user_id}",
            "logged_at": [f"gte.{day_start.isoformat()}", f"lt.{day_end.isoformat()}"],
        },
    )
    consumed_calories = sum(f["calories"] for f in food_logs)
    consumed_protein = sum(f["protein_g"] for f in food_logs)
    consumed_carbs = sum(f["carbs_g"] for f in food_logs)
    consumed_fat = sum(f["fat_g"] for f in food_logs)

    if profile:
        target = MacroTargets(
            calories=profile["target_calories"],
            protein_g=profile["target_protein_g"],
            carbs_g=profile["target_carbs_g"],
            fat_g=profile["target_fat_g"],
        )
    else:
        # No profile yet — fall back to a generic budget rather than 500ing;
        # the frontend always has a profile by the time this is reachable,
        # but the endpoint should degrade gracefully, not crash.
        target = MacroTargets(calories=2000, protein_g=150, carbs_g=200, fat_g=65)

    remaining = calculate_remaining_macros(
        target,
        consumed_calories=round(consumed_calories),
        consumed_protein_g=round(consumed_protein),
        consumed_carbs_g=round(consumed_carbs),
        consumed_fat_g=round(consumed_fat),
    )

    # Protein only stays the deciding factor while the gap is real —
    # otherwise a user who already hit their protein target for the day
    # would keep getting protein-dense foods pushed at them regardless of
    # what they actually still need.
    protein_is_priority = remaining.protein_g >= _PROTEIN_STILL_NEEDED_MIN_G and (
        target.protein_g <= 0
        or remaining.protein_g / target.protein_g >= _PROTEIN_STILL_NEEDED_FRACTION
    )

    # Two privacy-safe candidate sources: the shared/global eligible pool
    # (verified, or a real user's own globally-visible custom food; never
    # another user's personal AI estimate or unowned/unverified junk — see
    # suggest_foods_for_remaining), and this user's own recent/frequent
    # foods (scoped strictly to their own food_logs, so it's exactly as
    # privacy-safe as GET /api/foods/recent). Merged and deduped before
    # ranking so a food already known from the global pool doesn't get
    # counted twice just because the user has also logged it themselves.
    global_rows = db.rpc(
        "suggest_foods_for_remaining",
        {"remaining_calories": remaining.calories, "pool_limit": _CANDIDATE_POOL_LIMIT},
    )
    personal_candidates = _personal_history_candidates(db, current_user.user_id)

    candidates: dict[str, SuggestionCandidate] = {
        row["id"]: _to_candidate(row, is_personal_history=False) for row in global_rows
    }
    for candidate in personal_candidates:
        # A food already in the global pool keeps its personalization
        # bonus too if the user has also logged it themselves — merge
        # rather than let whichever source happened to be inserted last
        # silently win.
        existing = candidates.get(candidate.id)
        if existing is not None and not existing.is_personal_history:
            candidates[candidate.id] = SuggestionCandidate(
                **{**existing.__dict__, "is_personal_history": True}
            )
        elif existing is None:
            candidates[candidate.id] = candidate

    ranked = rank_candidates(
        list(candidates.values()),
        remaining_calories=remaining.calories,
        remaining_protein_g=remaining.protein_g,
        protein_is_priority=protein_is_priority,
        limit=FINAL_SUGGESTION_LIMIT,
    )
    suggestions = [
        SuggestedFood(
            id=c.id,
            name=c.name,
            brand=c.brand,
            serving_description=c.serving_description,
            calories=c.calories,
            protein_g=c.protein_g,
            carbs_g=c.carbs_g,
            fat_g=c.fat_g,
            verified=c.verified,
        )
        for c in ranked
    ]

    if not suggestions:
        # A true zero-candidate scenario (no eligible global foods and the
        # user has no relevant history of their own yet) — this should now
        # be rare, since ranking no longer requires an exact calorie fit.
        message = (
            f"{remaining.calories} kcal and {remaining.protein_g}g protein left today — "
            "no good matches yet. Try logging a custom food."
        )
    else:
        names = ", ".join(s.name for s in suggestions)
        if protein_is_priority:
            message = (
                f"{remaining.calories} kcal and {remaining.protein_g}g protein left — "
                f"good options to help close the gap: {names}."
            )
        else:
            message = (
                f"{remaining.calories} kcal left, and protein is on track — "
                f"good options for what's left today: {names}."
            )

    return SuggestionsResponse(
        message=message,
        remaining_calories=remaining.calories,
        remaining_protein_g=remaining.protein_g,
        remaining_carbs_g=remaining.carbs_g,
        remaining_fat_g=remaining.fat_g,
        protein_is_priority=protein_is_priority,
        suggestions=suggestions,
    )

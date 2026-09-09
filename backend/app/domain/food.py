"""Deterministic food-quantity math. Nutrition numbers always come from the
database (food_items) or a logged snapshot — never invented by AI. This
module only scales per-serving values by quantity and rounds for display.
"""

from dataclasses import dataclass

# A food_items row is treated as "close enough to be a likely duplicate" at
# or above this trigram similarity score (0..1), surfaced to the user as a
# suggestion rather than silently blocking creation (PRD §3.2).
DUPLICATE_SIMILARITY_THRESHOLD = 0.4


@dataclass(frozen=True)
class NutritionSnapshot:
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


def compute_nutrition_snapshot(
    *,
    calories_per_serving: float,
    protein_g_per_serving: float,
    carbs_g_per_serving: float,
    fat_g_per_serving: float,
    quantity: float,
) -> NutritionSnapshot:
    """Scales a food_items row's per-serving nutrition by the logged quantity.
    This is what gets written into food_logs' snapshot columns — computed
    once, at log time, and never recomputed from a possibly-since-edited
    food_items row afterward."""
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    return NutritionSnapshot(
        calories=round(calories_per_serving * quantity, 1),
        protein_g=round(protein_g_per_serving * quantity, 1),
        carbs_g=round(carbs_g_per_serving * quantity, 1),
        fat_g=round(fat_g_per_serving * quantity, 1),
    )


def likely_duplicates(
    candidates: list[dict], threshold: float = DUPLICATE_SIMILARITY_THRESHOLD
) -> list[dict]:
    """Filters search_food_items RPC results down to ones similar enough to
    warrant a duplicate warning before creating a new food_items row."""
    return [c for c in candidates if c.get("similarity", 0) >= threshold]

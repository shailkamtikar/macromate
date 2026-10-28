"""Pure helpers for the calendar: which targets applied on a given day, and
whether a day's totals were low / on target / high.

Nothing here touches the database or the clock, so every rule is unit-tested
(tests/test_day_summary.py). "On target" reuses the app-wide definition from
app/domain/progress.py: within +/-10% of the target.
"""

from dataclasses import dataclass
from datetime import date

from app.domain.progress import ADHERENCE_TOLERANCE

LOW, OK, HIGH, NONE = "low", "ok", "high", "none"


@dataclass(frozen=True)
class DayTargets:
    calories: int
    protein_g: int | None
    carbs_g: int | None
    fat_g: int | None
    water_goal_ml: int | None
    # True when this day predates any recorded target history, or the row
    # that covers it was back-filled from today's targets (no real history
    # exists before the feature shipped) -- the UI says so once, honestly.
    is_approximate: bool


def _row_targets(row: dict, *, approximate: bool) -> DayTargets:
    return DayTargets(
        calories=row["target_calories"],
        protein_g=row.get("target_protein_g"),
        carbs_g=row.get("target_carbs_g"),
        fat_g=row.get("target_fat_g"),
        water_goal_ml=row.get("water_goal_ml"),
        is_approximate=approximate,
    )


def targets_for_date(snapshots: list[dict], day: date, profile: dict) -> DayTargets:
    """The targets in force on `day`: the snapshot with the greatest
    `effective_from <= day`. Days before the first snapshot use the earliest
    one (approximate); a user with no snapshots at all falls back to the
    profile's current targets (approximate)."""
    ordered = sorted(snapshots, key=lambda r: r["effective_from"])
    chosen = None
    for row in ordered:
        if date.fromisoformat(row["effective_from"]) <= day:
            chosen = row
        else:
            break
    if chosen is not None:
        return _row_targets(chosen, approximate=bool(chosen.get("is_backfill")))
    if ordered:
        return _row_targets(ordered[0], approximate=True)
    return DayTargets(
        calories=profile["target_calories"],
        protein_g=profile.get("target_protein_g"),
        carbs_g=profile.get("target_carbs_g"),
        fat_g=profile.get("target_fat_g"),
        water_goal_ml=profile.get("water_goal_ml"),
        is_approximate=True,
    )


def macro_status(consumed: float, target: float | None) -> str:
    """"none" for an unlogged day (never treated as "0 kcal, too low", the
    same rule the weekly report follows), otherwise low / ok / high against
    the +/-10% band."""
    if not target or target <= 0 or consumed <= 0:
        return NONE
    ratio = consumed / target
    if ratio < 1 - ADHERENCE_TOLERANCE:
        return LOW
    if ratio > 1 + ADHERENCE_TOLERANCE:
        return HIGH
    return OK

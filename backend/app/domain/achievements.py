"""Deterministic achievement checks. Nothing here is stored — every
achievement is recomputed live from real logged rows, so there's no risk
of a stale/fake achievement record drifting from reality. Tone is always
positive: PRD §3.8 explicitly forbids negative reinforcement, so this
module only ever returns what was achieved, never what was missed.
"""

from dataclasses import dataclass
from datetime import date, timedelta

STREAK_MILESTONES = (3, 7, 14, 30)


@dataclass(frozen=True)
class AchievementsResult:
    current_streak_days: int
    milestones_hit: list[int]
    newest_milestone: int | None
    weight_lower_than_last: bool
    weight_delta_kg: float | None
    calorie_goal_hit_today: bool
    macro_goals_hit_today: dict[str, bool]


def calculate_logging_streak(logged_dates: set[date], today: date) -> int:
    """Consecutive days with at least one food log, counting backward from
    today. If nothing was logged today, the streak still counts through
    yesterday (the streak isn't broken until a full day passes with
    nothing logged) — matches the "log before midnight to keep your
    streak" framing in PRD §3.4."""
    anchor = today if today in logged_dates else today - timedelta(days=1)
    if anchor not in logged_dates:
        return 0
    streak = 0
    cursor = anchor
    while cursor in logged_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def milestones_reached(streak_days: int) -> list[int]:
    return [m for m in STREAK_MILESTONES if streak_days >= m]


def weight_progress(recent_weights_kg: list[tuple[date, float]]) -> tuple[bool, float | None]:
    """Compares the two most recent weight_logs. `recent_weights_kg` must
    be sorted ascending by date."""
    if len(recent_weights_kg) < 2:
        return False, None
    (_, previous), (_, latest) = recent_weights_kg[-2], recent_weights_kg[-1]
    delta = round(latest - previous, 1)
    return latest < previous, delta


def macro_goals_hit(
    *,
    consumed_calories: float,
    target_calories: float,
    consumed_protein_g: float,
    target_protein_g: float,
    consumed_carbs_g: float,
    target_carbs_g: float,
    consumed_fat_g: float,
    target_fat_g: float,
    tolerance: float = 0.10,
) -> dict[str, bool]:
    def hit(consumed: float, target: float) -> bool:
        return target > 0 and abs(consumed - target) <= target * tolerance

    return {
        "calories": hit(consumed_calories, target_calories),
        "protein": hit(consumed_protein_g, target_protein_g),
        "carbs": hit(consumed_carbs_g, target_carbs_g),
        "fat": hit(consumed_fat_g, target_fat_g),
    }


def build_achievements(
    *,
    logged_dates: set[date],
    today: date,
    recent_weights_kg: list[tuple[date, float]],
    consumed_calories: float,
    target_calories: float,
    consumed_protein_g: float,
    target_protein_g: float,
    consumed_carbs_g: float,
    target_carbs_g: float,
    consumed_fat_g: float,
    target_fat_g: float,
) -> AchievementsResult:
    streak = calculate_logging_streak(logged_dates, today)
    hit_milestones = milestones_reached(streak)
    weight_lower, weight_delta = weight_progress(recent_weights_kg)
    macro_hits = macro_goals_hit(
        consumed_calories=consumed_calories,
        target_calories=target_calories,
        consumed_protein_g=consumed_protein_g,
        target_protein_g=target_protein_g,
        consumed_carbs_g=consumed_carbs_g,
        target_carbs_g=target_carbs_g,
        consumed_fat_g=consumed_fat_g,
        target_fat_g=target_fat_g,
    )

    return AchievementsResult(
        current_streak_days=streak,
        milestones_hit=hit_milestones,
        newest_milestone=hit_milestones[-1] if hit_milestones else None,
        weight_lower_than_last=weight_lower,
        weight_delta_kg=weight_delta,
        calorie_goal_hit_today=macro_hits["calories"],
        macro_goals_hit_today=macro_hits,
    )

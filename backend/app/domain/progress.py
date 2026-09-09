"""Deterministic weekly progress aggregation. Every number here is computed
from real logged rows — no AI, no fabricated trend data.

Adherence definition (PRD leaves the exact formula open, documented here
per that instruction): a day counts as "goal hit" if that day's logged
calories are within +/-10% of the daily calorie target. Simple, explainable,
and consistent with how the Today dashboard already frames "on track."
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

ADHERENCE_TOLERANCE = 0.10


@dataclass(frozen=True)
class DailyTotals:
    day: date
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


@dataclass(frozen=True)
class WeekSummary:
    week_start: date
    week_end: date
    avg_calories: float
    avg_protein_g: float
    avg_carbs_g: float
    avg_fat_g: float
    days_logged: int
    days_goal_hit: int
    adherence_pct: int


@dataclass(frozen=True)
class WeightTrend:
    start_kg: float | None
    end_kg: float | None
    delta_kg: float | None


@dataclass(frozen=True)
class WeeklyReport:
    current: WeekSummary
    previous: WeekSummary
    weight_trend: WeightTrend
    wins: list[str] = field(default_factory=list)


def week_bounds(reference: date) -> tuple[date, date]:
    """Monday-Sunday week containing `reference`."""
    start = reference - timedelta(days=reference.weekday())
    return start, start + timedelta(days=6)


def group_food_logs_by_day(
    food_logs: list[dict], week_start: date
) -> dict[date, DailyTotals]:
    totals: dict[date, DailyTotals] = {}
    for i in range(7):
        day = week_start + timedelta(days=i)
        totals[day] = DailyTotals(day, 0.0, 0.0, 0.0, 0.0)

    accum: dict[date, list[float]] = {d: [0.0, 0.0, 0.0, 0.0] for d in totals}
    for log in food_logs:
        logged_at = log["logged_at"]
        day = (
            date.fromisoformat(logged_at[:10])
            if isinstance(logged_at, str)
            else logged_at.date()
        )
        if day not in accum:
            continue
        accum[day][0] += log["calories"]
        accum[day][1] += log["protein_g"]
        accum[day][2] += log["carbs_g"]
        accum[day][3] += log["fat_g"]

    for day, (cal, pro, carb, fat) in accum.items():
        totals[day] = DailyTotals(day, cal, pro, carb, fat)
    return totals


def summarize_week(
    daily_totals: dict[date, DailyTotals], week_start: date, target_calories: float
) -> WeekSummary:
    week_end = week_start + timedelta(days=6)
    days_logged = sum(1 for d in daily_totals.values() if d.calories > 0)
    days_goal_hit = sum(
        1
        for d in daily_totals.values()
        if d.calories > 0
        and abs(d.calories - target_calories) <= target_calories * ADHERENCE_TOLERANCE
    )
    n = len(daily_totals) or 1
    return WeekSummary(
        week_start=week_start,
        week_end=week_end,
        avg_calories=round(sum(d.calories for d in daily_totals.values()) / n, 1),
        avg_protein_g=round(sum(d.protein_g for d in daily_totals.values()) / n, 1),
        avg_carbs_g=round(sum(d.carbs_g for d in daily_totals.values()) / n, 1),
        avg_fat_g=round(sum(d.fat_g for d in daily_totals.values()) / n, 1),
        days_logged=days_logged,
        days_goal_hit=days_goal_hit,
        adherence_pct=round((days_goal_hit / 7) * 100),
    )


def compute_weight_trend(weight_logs_in_week: list[dict]) -> WeightTrend:
    if not weight_logs_in_week:
        return WeightTrend(None, None, None)
    sorted_logs = sorted(weight_logs_in_week, key=lambda w: w["logged_at"])
    start = sorted_logs[0]["weight_kg"]
    end = sorted_logs[-1]["weight_kg"]
    return WeightTrend(start_kg=start, end_kg=end, delta_kg=round(end - start, 1))


def compute_wins(current: WeekSummary, previous: WeekSummary) -> list[str]:
    """Encouraging, never shaming (PRD §3.8) — only states genuine
    improvements; silent (no win) rather than negative when things
    regressed."""
    wins = []
    if current.days_goal_hit > previous.days_goal_hit:
        wins.append(
            f"You hit your calorie goal {current.days_goal_hit}/7 days — up from "
            f"{previous.days_goal_hit}/7 last week!"
        )
    if previous.avg_protein_g > 0 and current.avg_protein_g > previous.avg_protein_g:
        wins.append(
            f"Average protein intake rose from {previous.avg_protein_g}g to "
            f"{current.avg_protein_g}g/day."
        )
    if current.days_logged > previous.days_logged:
        wins.append(
            f"You logged {current.days_logged}/7 days this week, up from "
            f"{previous.days_logged}/7."
        )
    return wins


def build_weekly_report(
    *,
    current_food_logs: list[dict],
    previous_food_logs: list[dict],
    current_weight_logs: list[dict],
    current_week_start: date,
    previous_week_start: date,
    target_calories: float,
) -> WeeklyReport:
    current_daily = group_food_logs_by_day(current_food_logs, current_week_start)
    previous_daily = group_food_logs_by_day(previous_food_logs, previous_week_start)

    current_summary = summarize_week(current_daily, current_week_start, target_calories)
    previous_summary = summarize_week(previous_daily, previous_week_start, target_calories)

    return WeeklyReport(
        current=current_summary,
        previous=previous_summary,
        weight_trend=compute_weight_trend(current_weight_logs),
        wins=compute_wins(current_summary, previous_summary),
    )

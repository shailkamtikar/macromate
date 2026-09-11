"""Deterministic weekly progress aggregation. Every number here is computed
from real logged rows — no AI, no fabricated trend data.

Adherence definition (PRD leaves the exact formula open, documented here
per that instruction, and reused as-is from app/domain/achievements.py's
`macro_goals_hit`, the only other place this app already defines "on
target"): a day counts as "goal hit" for a given macro if that day's logged
total for it is within +/-10% of that macro's daily target. Simple,
explainable, and consistent with how the Today dashboard already frames
"on track."

A day only ever counts toward any of this if it was actually logged
(calories > 0) — an unlogged day is never treated as "0 calories, missed
goal"; it is simply excluded from the numerator AND the average's
denominator (which divides by days actually logged, not calendar days), so
a week with gaps in it still reports an honest daily average rather than
one diluted by days with no data. `days_in_period` (<=7, defaults to 7 for
a complete week) exists specifically for a currently-in-progress week: the
calendar-day denominator for adherence percentages and the "N of M days
logged" framing must only ever count days that have actually happened.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

from app.domain.timeutil import utc_timestamp_to_local_date

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
    # Calorie adherence -- names kept as-is (no "calorie_" prefix) since
    # these predate the protein/carbs/fat adherence fields below and other
    # code/tests already refer to them this way.
    days_goal_hit: int
    adherence_pct: int
    # Number of calendar days this summary actually covers (7 for any
    # complete week; less than 7 only for the currently-in-progress week).
    days_in_period: int = 7
    is_partial: bool = False
    protein_days_hit: int = 0
    protein_adherence_pct: int = 0
    carbs_days_hit: int = 0
    carbs_adherence_pct: int = 0
    fat_days_hit: int = 0
    fat_adherence_pct: int = 0
    # Specifically *below* target (not just outside the +/-10% band either
    # way) -- the more precise, PRD-worded signal an improvement note needs
    # ("protein was below target on N days"), distinct from protein_days_hit.
    protein_days_below_target: int = 0


@dataclass(frozen=True)
class WeightTrend:
    start_kg: float | None
    end_kg: float | None
    delta_kg: float | None
    sample_size: int = 0


@dataclass(frozen=True)
class WeeklyReport:
    current: WeekSummary
    previous: WeekSummary
    weight_trend: WeightTrend
    wins: list[str] = field(default_factory=list)
    improvement_areas: list[str] = field(default_factory=list)


def week_bounds(reference: date) -> tuple[date, date]:
    """Monday-Sunday week containing `reference`."""
    start = reference - timedelta(days=reference.weekday())
    return start, start + timedelta(days=6)


def group_food_logs_by_day(
    food_logs: list[dict], week_start: date, tz_name: str | None = None
) -> dict[date, DailyTotals]:
    totals: dict[date, DailyTotals] = {}
    for i in range(7):
        day = week_start + timedelta(days=i)
        totals[day] = DailyTotals(day, 0.0, 0.0, 0.0, 0.0)

    accum: dict[date, list[float]] = {d: [0.0, 0.0, 0.0, 0.0] for d in totals}
    for log in food_logs:
        # logged_at is stored as a UTC timestamptz; bucket it by the day it
        # fell on in the user's own timezone, not the UTC calendar day.
        day = utc_timestamp_to_local_date(log["logged_at"], tz_name)
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
    daily_totals: dict[date, DailyTotals],
    week_start: date,
    target_calories: float,
    *,
    target_protein_g: float | None = None,
    target_carbs_g: float | None = None,
    target_fat_g: float | None = None,
    days_in_period: int = 7,
) -> WeekSummary:
    days_in_period = max(1, min(days_in_period, 7))
    week_end = week_start + timedelta(days=6)

    # Only days that have actually happened count -- for a complete week
    # that's all 7 pre-seeded days; for the currently-in-progress week,
    # `days_in_period` excludes days that haven't occurred yet so they're
    # never mistaken for "unlogged".
    considered = [
        daily_totals[week_start + timedelta(days=i)]
        for i in range(days_in_period)
        if (week_start + timedelta(days=i)) in daily_totals
    ]
    logged = [d for d in considered if d.calories > 0]
    days_logged = len(logged)

    def hit_count(target: float | None, attr: str) -> int:
        if not target:
            return 0
        return sum(
            1 for d in logged if abs(getattr(d, attr) - target) <= target * ADHERENCE_TOLERANCE
        )

    def avg(attr: str) -> float:
        if not days_logged:
            return 0.0
        return round(sum(getattr(d, attr) for d in logged) / days_logged, 1)

    def pct(hit_n: int) -> int:
        return round(hit_n / days_in_period * 100)

    days_goal_hit = hit_count(target_calories, "calories")
    protein_days_hit = hit_count(target_protein_g, "protein_g")
    carbs_days_hit = hit_count(target_carbs_g, "carbs_g")
    fat_days_hit = hit_count(target_fat_g, "fat_g")
    protein_days_below_target = (
        sum(1 for d in logged if d.protein_g < target_protein_g * (1 - ADHERENCE_TOLERANCE))
        if target_protein_g
        else 0
    )

    return WeekSummary(
        week_start=week_start,
        week_end=week_end,
        avg_calories=avg("calories"),
        avg_protein_g=avg("protein_g"),
        avg_carbs_g=avg("carbs_g"),
        avg_fat_g=avg("fat_g"),
        days_logged=days_logged,
        days_goal_hit=days_goal_hit,
        adherence_pct=pct(days_goal_hit),
        days_in_period=days_in_period,
        is_partial=days_in_period < 7,
        protein_days_hit=protein_days_hit,
        protein_adherence_pct=pct(protein_days_hit) if target_protein_g else 0,
        carbs_days_hit=carbs_days_hit,
        carbs_adherence_pct=pct(carbs_days_hit) if target_carbs_g else 0,
        fat_days_hit=fat_days_hit,
        fat_adherence_pct=pct(fat_days_hit) if target_fat_g else 0,
        protein_days_below_target=protein_days_below_target,
    )


def compute_weight_trend(weight_logs_in_week: list[dict]) -> WeightTrend:
    if not weight_logs_in_week:
        return WeightTrend(None, None, None, 0)
    sorted_logs = sorted(weight_logs_in_week, key=lambda w: w["logged_at"])
    start = sorted_logs[0]["weight_kg"]
    end = sorted_logs[-1]["weight_kg"]
    return WeightTrend(
        start_kg=start, end_kg=end, delta_kg=round(end - start, 1), sample_size=len(sorted_logs)
    )


# A single-week weight change smaller than this is normal day-to-day
# fluctuation, not a real trend -- never claimed as one (PRD §3.4: "do not
# call ordinary day-to-day fluctuations 'fat loss'").
WEIGHT_TREND_NOISE_FLOOR_KG = 0.2


def compute_wins(
    current: WeekSummary,
    previous: WeekSummary,
    *,
    weight_trend: WeightTrend | None = None,
    goal: str | None = None,
) -> list[str]:
    """Encouraging, never shaming (PRD §3.8) — only states genuine
    improvements; silent (no win) rather than negative when things
    regressed."""
    wins = []
    if current.days_goal_hit > previous.days_goal_hit:
        wins.append(
            f"You hit your calorie goal {current.days_goal_hit}/{current.days_in_period} days — "
            f"up from {previous.days_goal_hit}/{previous.days_in_period} last week!"
        )
    if current.protein_days_hit > previous.protein_days_hit:
        wins.append(
            f"Protein on target {current.protein_days_hit}/{current.days_in_period} days — up "
            f"from {previous.protein_days_hit}/{previous.days_in_period} last week!"
        )
    if previous.avg_protein_g > 0 and current.avg_protein_g > previous.avg_protein_g:
        wins.append(
            f"Average protein intake rose from {previous.avg_protein_g}g to "
            f"{current.avg_protein_g}g/day."
        )
    if current.days_logged > previous.days_logged:
        wins.append(
            f"You logged {current.days_logged}/{current.days_in_period} days this week, up from "
            f"{previous.days_logged}/{previous.days_in_period}."
        )
    # A real (multi-entry, not single-point) weight move in the direction of
    # the user's own goal -- never claimed from noise-floor fluctuation or a
    # lone weigh-in.
    if weight_trend and goal and weight_trend.sample_size >= 2 and weight_trend.delta_kg is not None:
        if goal == "cut" and weight_trend.delta_kg <= -WEIGHT_TREND_NOISE_FLOOR_KG:
            wins.append(
                f"Your weight is trending down this week ({weight_trend.delta_kg}kg), in line "
                "with your goal."
            )
        elif goal == "bulk" and weight_trend.delta_kg >= WEIGHT_TREND_NOISE_FLOOR_KG:
            wins.append(
                f"Your weight is trending up this week (+{weight_trend.delta_kg}kg), in line "
                "with your goal."
            )
        elif goal == "maintain" and abs(weight_trend.delta_kg) < WEIGHT_TREND_NOISE_FLOOR_KG:
            wins.append("Your weight held steady this week, right in line with your maintenance goal.")
    return wins


def compute_improvement_areas(current: WeekSummary, previous: WeekSummary) -> list[str]:
    """At most two constructive, non-judgmental notes on where this week
    could improve (PRD §3.13) — every note is a concrete, actionable metric,
    never a vague or shaming statement, and this never duplicates a win
    (a metric that improved is reported by compute_wins, not here)."""
    areas: list[str] = []

    missed_days = current.days_in_period - current.days_logged
    if missed_days >= 2:
        period_label = "week so far" if current.is_partial else "week"
        areas.append(f"You logged {current.days_logged} of {current.days_in_period} days this {period_label}.")

    if current.protein_days_below_target >= 2:
        areas.append(
            f"Protein was below target on {current.protein_days_below_target} of the days you "
            "logged this week."
        )

    if (
        current.days_logged > 0
        and previous.days_logged > 0
        and current.adherence_pct < previous.adherence_pct
    ):
        areas.append("Your calorie adherence was less consistent than last week.")

    return areas[:2]


def build_weekly_report(
    *,
    current_food_logs: list[dict],
    previous_food_logs: list[dict],
    current_weight_logs: list[dict],
    current_week_start: date,
    previous_week_start: date,
    target_calories: float,
    target_protein_g: float | None = None,
    target_carbs_g: float | None = None,
    target_fat_g: float | None = None,
    current_days_in_period: int = 7,
    goal: str | None = None,
    tz_name: str | None = None,
) -> WeeklyReport:
    current_daily = group_food_logs_by_day(current_food_logs, current_week_start, tz_name)
    previous_daily = group_food_logs_by_day(previous_food_logs, previous_week_start, tz_name)

    current_summary = summarize_week(
        current_daily,
        current_week_start,
        target_calories,
        target_protein_g=target_protein_g,
        target_carbs_g=target_carbs_g,
        target_fat_g=target_fat_g,
        days_in_period=current_days_in_period,
    )
    previous_summary = summarize_week(
        previous_daily,
        previous_week_start,
        target_calories,
        target_protein_g=target_protein_g,
        target_carbs_g=target_carbs_g,
        target_fat_g=target_fat_g,
    )

    weight_trend = compute_weight_trend(current_weight_logs)
    return WeeklyReport(
        current=current_summary,
        previous=previous_summary,
        weight_trend=weight_trend,
        wins=compute_wins(current_summary, previous_summary, weight_trend=weight_trend, goal=goal),
        improvement_areas=compute_improvement_areas(current_summary, previous_summary),
    )

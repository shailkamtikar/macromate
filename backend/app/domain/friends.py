"""Discipline score for the friend leaderboard.

PRD §8 (Open Questions) leaves the exact discipline-score formula
undefined and explicitly invites a decision. Chosen formula, documented
here per that instruction: 7-day adherence % — the same "days within
+/-10% of calorie target" definition already used for weekly reports
(app/domain/progress.py) and achievements, kept consistent across every
feature that reasons about "did you hit your goal" rather than inventing
a second metric.
"""

from dataclasses import dataclass
from datetime import date

from app.domain.progress import group_food_logs_by_day, summarize_week


@dataclass(frozen=True)
class DisciplineScore:
    user_id: str
    username: str
    discipline_score: int
    days_logged: int
    is_self: bool


def compute_discipline_score(
    *,
    user_id: str,
    username: str,
    food_logs: list[dict],
    week_start: date,
    target_calories: float,
    is_self: bool,
    tz_name: str | None = None,
) -> DisciplineScore:
    daily = group_food_logs_by_day(food_logs, week_start, tz_name)
    summary = summarize_week(daily, week_start, target_calories)
    return DisciplineScore(
        user_id=user_id,
        username=username,
        discipline_score=summary.adherence_pct,
        days_logged=summary.days_logged,
        is_self=is_self,
    )


def rank_leaderboard(scores: list[DisciplineScore]) -> list[DisciplineScore]:
    return sorted(scores, key=lambda s: s.discipline_score, reverse=True)

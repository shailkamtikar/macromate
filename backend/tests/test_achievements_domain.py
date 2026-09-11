from datetime import date, timedelta

from app.domain.achievements import (
    build_achievements,
    calculate_logging_streak,
    macro_goals_hit,
    milestones_reached,
    weight_progress,
)


def test_streak_counts_consecutive_days_including_today():
    today = date(2026, 9, 9)
    logged = {today, today - timedelta(days=1), today - timedelta(days=2)}
    assert calculate_logging_streak(logged, today) == 3


def test_streak_still_counts_if_today_not_yet_logged():
    today = date(2026, 9, 9)
    logged = {today - timedelta(days=1), today - timedelta(days=2)}
    assert calculate_logging_streak(logged, today) == 2


def test_streak_zero_after_a_missed_day():
    today = date(2026, 9, 9)
    logged = {today - timedelta(days=2)}  # gap yesterday and today
    assert calculate_logging_streak(logged, today) == 0


def test_milestones_reached():
    assert milestones_reached(2) == []
    assert milestones_reached(3) == [3]
    assert milestones_reached(10) == [3, 7]
    assert milestones_reached(30) == [3, 7, 14, 30]


def test_weight_progress_detects_loss():
    weights = [(date(2026, 9, 1), 76.0), (date(2026, 9, 8), 75.0)]
    lower, delta = weight_progress(weights)
    assert lower is True
    assert delta == -1.0


def test_weight_progress_no_data():
    assert weight_progress([]) == (False, None)
    assert weight_progress([(date(2026, 9, 1), 76.0)]) == (False, None)


def test_weight_progress_ignores_trivial_fluctuation():
    """A 0.1kg drop is ordinary scale noise, not meaningful progress --
    must not be presented as a win."""
    weights = [(date(2026, 9, 1), 76.0), (date(2026, 9, 8), 75.9)]
    lower, delta = weight_progress(weights)
    assert lower is False
    assert delta == -0.1


def test_weight_progress_detects_gain_without_claiming_loss():
    weights = [(date(2026, 9, 1), 75.0), (date(2026, 9, 8), 75.8)]
    lower, delta = weight_progress(weights)
    assert lower is False
    assert delta == 0.8


def test_macro_goals_hit_within_tolerance():
    result = macro_goals_hit(
        consumed_calories=2050,
        target_calories=2000,
        consumed_protein_g=100,
        target_protein_g=150,
        consumed_carbs_g=200,
        target_carbs_g=200,
        consumed_fat_g=65,
        target_fat_g=65,
    )
    assert result["calories"] is True  # within 10%
    assert result["protein"] is False  # 100 vs 150 is way off
    assert result["carbs"] is True
    assert result["fat"] is True


def test_build_achievements_never_shames_missed_goals():
    today = date(2026, 9, 9)
    result = build_achievements(
        logged_dates=set(),
        today=today,
        recent_weights_kg=[],
        consumed_calories=0,
        target_calories=2000,
        consumed_protein_g=0,
        target_protein_g=150,
        consumed_carbs_g=0,
        target_carbs_g=200,
        consumed_fat_g=0,
        target_fat_g=65,
    )
    # No streak, no milestones, no weight win — but the object itself is
    # just neutral/empty, not a negative message.
    assert result.current_streak_days == 0
    assert result.milestones_hit == []
    assert result.weight_lower_than_last is False

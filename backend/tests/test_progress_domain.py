from datetime import date

from app.domain.progress import (
    WeekSummary,
    WeightTrend,
    build_weekly_report,
    compute_improvement_areas,
    compute_weight_trend,
    compute_wins,
    group_food_logs_by_day,
    summarize_week,
    week_bounds,
)


def test_week_bounds_returns_monday_to_sunday():
    # 2026-09-09 is a Wednesday.
    start, end = week_bounds(date(2026, 9, 9))
    assert start == date(2026, 9, 7)  # Monday
    assert end == date(2026, 9, 13)  # Sunday


def test_group_food_logs_by_day_buckets_correctly():
    week_start = date(2026, 9, 7)
    logs = [
        {"logged_at": "2026-09-07T08:00:00+00:00", "calories": 500, "protein_g": 30, "carbs_g": 50, "fat_g": 15},
        {"logged_at": "2026-09-07T18:00:00+00:00", "calories": 300, "protein_g": 20, "carbs_g": 30, "fat_g": 10},
        {"logged_at": "2026-09-08T08:00:00+00:00", "calories": 400, "protein_g": 25, "carbs_g": 40, "fat_g": 12},
    ]
    grouped = group_food_logs_by_day(logs, week_start)
    assert grouped[date(2026, 9, 7)].calories == 800
    assert grouped[date(2026, 9, 8)].calories == 400
    assert grouped[date(2026, 9, 9)].calories == 0
    assert len(grouped) == 7


def test_summarize_week_computes_adherence_within_tolerance():
    week_start = date(2026, 9, 7)
    logs = [
        {"logged_at": "2026-09-07T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
        {"logged_at": "2026-09-08T08:00:00+00:00", "calories": 2900, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
    ]
    grouped = group_food_logs_by_day(logs, week_start)
    summary = summarize_week(grouped, week_start, target_calories=2000)
    assert summary.days_logged == 2
    assert summary.days_goal_hit == 1  # 2000 within 10%, 2900 is not
    assert summary.adherence_pct == round(1 / 7 * 100)


def test_compute_weight_trend_uses_first_and_last_by_time():
    logs = [
        {"logged_at": "2026-09-10T08:00:00+00:00", "weight_kg": 74.0},
        {"logged_at": "2026-09-07T08:00:00+00:00", "weight_kg": 75.0},
    ]
    trend = compute_weight_trend(logs)
    assert trend.start_kg == 75.0
    assert trend.end_kg == 74.0
    assert trend.delta_kg == -1.0


def test_compute_weight_trend_empty():
    trend = compute_weight_trend([])
    assert trend.start_kg is None


def test_build_weekly_report_generates_win_when_adherence_improves():
    current_logs = [
        {"logged_at": f"2026-09-{d:02d}T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60}
        for d in range(7, 12)
    ]
    previous_logs = [
        {"logged_at": "2026-08-31T08:00:00+00:00", "calories": 3000, "protein_g": 100, "carbs_g": 200, "fat_g": 60},
        {"logged_at": "2026-09-01T08:00:00+00:00", "calories": 3000, "protein_g": 100, "carbs_g": 200, "fat_g": 60},
    ]
    report = build_weekly_report(
        current_food_logs=current_logs,
        previous_food_logs=previous_logs,
        current_weight_logs=[],
        current_week_start=date(2026, 9, 7),
        previous_week_start=date(2026, 8, 31),
        target_calories=2000,
    )
    assert report.current.days_goal_hit == 5
    assert len(report.wins) > 0


def test_summarize_week_averages_over_logged_days_not_all_seven():
    """PRD §10: an unlogged day must never be treated as 0 calories --
    averages divide by days actually logged, not by 7."""
    week_start = date(2026, 9, 7)
    logs = [
        {"logged_at": "2026-09-07T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
        {"logged_at": "2026-09-08T08:00:00+00:00", "calories": 1000, "protein_g": 50, "carbs_g": 100, "fat_g": 30},
    ]
    grouped = group_food_logs_by_day(logs, week_start)
    summary = summarize_week(grouped, week_start, target_calories=2000)
    assert summary.days_logged == 2
    # (2000 + 1000) / 2 logged days = 1500, not /7.
    assert summary.avg_calories == 1500.0


def test_summarize_week_with_no_logged_days_has_zero_averages_not_error():
    week_start = date(2026, 9, 7)
    grouped = group_food_logs_by_day([], week_start)
    summary = summarize_week(grouped, week_start, target_calories=2000)
    assert summary.days_logged == 0
    assert summary.avg_calories == 0.0
    assert summary.adherence_pct == 0


def test_summarize_week_partial_current_week_only_considers_elapsed_days():
    """Scenario G: current week has only 2 completed days -- a log on day 3
    (which hasn't happened yet from the report's point of view) must not
    count toward days_logged/adherence, and the denominator must be 2, not 7."""
    week_start = date(2026, 9, 7)  # Monday
    logs = [
        {"logged_at": "2026-09-07T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
        {"logged_at": "2026-09-08T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
        # Wednesday -- outside the 2-day "elapsed so far" window.
        {"logged_at": "2026-09-09T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
    ]
    grouped = group_food_logs_by_day(logs, week_start)
    summary = summarize_week(grouped, week_start, target_calories=2000, days_in_period=2)
    assert summary.days_in_period == 2
    assert summary.is_partial is True
    assert summary.days_logged == 2
    assert summary.days_goal_hit == 2
    assert summary.adherence_pct == 100


def test_summarize_week_computes_protein_carbs_fat_adherence():
    week_start = date(2026, 9, 7)
    logs = [
        # Protein/carbs/fat all within 10% of target.
        {"logged_at": "2026-09-07T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
        # Protein clearly below target; carbs/fat still on target.
        {"logged_at": "2026-09-08T08:00:00+00:00", "calories": 1800, "protein_g": 90, "carbs_g": 200, "fat_g": 60},
    ]
    grouped = group_food_logs_by_day(logs, week_start)
    summary = summarize_week(
        grouped,
        week_start,
        target_calories=2000,
        target_protein_g=150,
        target_carbs_g=200,
        target_fat_g=60,
    )
    assert summary.protein_days_hit == 1
    assert summary.carbs_days_hit == 2
    assert summary.fat_days_hit == 2
    assert summary.protein_days_below_target == 1


def test_summarize_week_without_macro_targets_reports_zero_macro_adherence():
    week_start = date(2026, 9, 7)
    logs = [
        {"logged_at": "2026-09-07T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
    ]
    grouped = group_food_logs_by_day(logs, week_start)
    summary = summarize_week(grouped, week_start, target_calories=2000)
    assert summary.protein_days_hit == 0
    assert summary.protein_adherence_pct == 0
    assert summary.protein_days_below_target == 0


def test_compute_weight_trend_reports_sample_size():
    trend = compute_weight_trend(
        [
            {"logged_at": "2026-09-07T08:00:00+00:00", "weight_kg": 75.0},
            {"logged_at": "2026-09-10T08:00:00+00:00", "weight_kg": 74.0},
        ]
    )
    assert trend.sample_size == 2

    single = compute_weight_trend([{"logged_at": "2026-09-07T08:00:00+00:00", "weight_kg": 75.0}])
    assert single.sample_size == 1
    assert single.delta_kg == 0.0  # same reading as both "start" and "end" -- not a fabricated trend


def _summary(**overrides):
    base = dict(
        week_start=date(2026, 9, 7),
        week_end=date(2026, 9, 13),
        avg_calories=2000.0,
        avg_protein_g=150.0,
        avg_carbs_g=200.0,
        avg_fat_g=60.0,
        days_logged=5,
        days_goal_hit=5,
        adherence_pct=71,
        days_in_period=7,
        is_partial=False,
        protein_days_hit=5,
        protein_adherence_pct=71,
        carbs_days_hit=5,
        carbs_adherence_pct=71,
        fat_days_hit=5,
        fat_adherence_pct=71,
        protein_days_below_target=0,
    )
    base.update(overrides)
    return WeekSummary(**base)


def test_compute_wins_includes_protein_adherence_improvement():
    current = _summary(protein_days_hit=5)
    previous = _summary(protein_days_hit=2)
    wins = compute_wins(current, previous)
    assert any("Protein on target" in w for w in wins)


def test_compute_wins_weight_trend_toward_goal_requires_multiple_entries_and_a_real_move():
    current = _summary()
    previous = _summary()

    # A single-entry "trend" (sample_size 1) must never be claimed as a win,
    # even if delta_kg happens to be 0.
    lone_entry = WeightTrend(start_kg=80.0, end_kg=80.0, delta_kg=0.0, sample_size=1)
    assert compute_wins(current, previous, weight_trend=lone_entry, goal="cut") == []

    # Noise-floor fluctuation (< 0.2kg) must not be claimed as progress.
    noise = WeightTrend(start_kg=80.0, end_kg=79.9, delta_kg=-0.1, sample_size=2)
    assert compute_wins(current, previous, weight_trend=noise, goal="cut") == []

    # A real move in the direction of the user's actual goal is a win.
    real_loss = WeightTrend(start_kg=80.0, end_kg=79.5, delta_kg=-0.5, sample_size=2)
    wins = compute_wins(current, previous, weight_trend=real_loss, goal="cut")
    assert any("trending down" in w for w in wins)

    # The same move is NOT framed as a win for a "bulk" goal.
    assert compute_wins(current, previous, weight_trend=real_loss, goal="bulk") == []


def test_compute_improvement_areas_flags_missed_logging_days():
    current = _summary(days_logged=3, days_in_period=7)
    previous = _summary(days_logged=5, days_in_period=7, adherence_pct=71)
    areas = compute_improvement_areas(current, previous)
    assert any("3 of 7 days" in a for a in areas)


def test_compute_improvement_areas_flags_protein_below_target():
    current = _summary(days_logged=7, protein_days_below_target=3)
    previous = _summary()
    areas = compute_improvement_areas(current, previous)
    assert any("Protein was below target" in a for a in areas)


def test_compute_improvement_areas_caps_at_two_even_when_everything_regressed():
    current = _summary(days_logged=2, days_in_period=7, adherence_pct=20, protein_days_below_target=4)
    previous = _summary(days_logged=6, adherence_pct=80)
    areas = compute_improvement_areas(current, previous)
    assert len(areas) == 2


def test_compute_improvement_areas_is_silent_for_a_brand_new_user_with_no_data():
    """No previous-week data to compare against, and no logged days this
    week either -- nothing concrete to say yet, so nothing shaming should
    be manufactured just to fill the section."""
    current = _summary(days_logged=0, days_in_period=1, is_partial=True, adherence_pct=0, protein_days_below_target=0)
    previous = _summary(days_logged=0, adherence_pct=0)
    areas = compute_improvement_areas(current, previous)
    assert areas == []

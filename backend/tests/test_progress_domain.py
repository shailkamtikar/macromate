from datetime import date

from app.domain.progress import (
    build_weekly_report,
    compute_weight_trend,
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

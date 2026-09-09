from datetime import date

from app.domain.friends import compute_discipline_score, rank_leaderboard


def test_compute_discipline_score_matches_adherence():
    week_start = date(2026, 9, 7)
    logs = [
        {"logged_at": "2026-09-07T08:00:00+00:00", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 65},
    ]
    score = compute_discipline_score(
        user_id="u1", username="alice", food_logs=logs, week_start=week_start,
        target_calories=2000, is_self=True,
    )
    assert score.discipline_score == round(1 / 7 * 100)
    assert score.days_logged == 1


def test_rank_leaderboard_sorts_descending():
    scores = [
        compute_discipline_score(user_id="a", username="a", food_logs=[], week_start=date(2026, 9, 7), target_calories=2000, is_self=False),
        compute_discipline_score(
            user_id="b", username="b",
            food_logs=[{"logged_at": "2026-09-07T08:00:00+00:00", "calories": 2000, "protein_g": 1, "carbs_g": 1, "fat_g": 1}],
            week_start=date(2026, 9, 7), target_calories=2000, is_self=False,
        ),
    ]
    ranked = rank_leaderboard(scores)
    assert ranked[0].username == "b"
    assert ranked[1].username == "a"

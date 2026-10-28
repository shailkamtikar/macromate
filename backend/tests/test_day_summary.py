from datetime import date

from app.domain.day_summary import HIGH, LOW, NONE, OK, macro_status, targets_for_date

PROFILE = {
    "target_calories": 2000,
    "target_protein_g": 150,
    "target_carbs_g": 200,
    "target_fat_g": 60,
    "water_goal_ml": 2500,
}


def snap(effective_from, calories, backfill=False):
    return {
        "effective_from": effective_from,
        "target_calories": calories,
        "target_protein_g": 150,
        "target_carbs_g": 200,
        "target_fat_g": 60,
        "water_goal_ml": 2500,
        "is_backfill": backfill,
    }


def test_each_day_uses_the_targets_in_force_on_that_day():
    snaps = [snap("2026-10-01", 2400), snap("2026-10-10", 2100), snap("2026-10-20", 1900)]
    assert targets_for_date(snaps, date(2026, 10, 5), PROFILE).calories == 2400
    assert targets_for_date(snaps, date(2026, 10, 10), PROFILE).calories == 2100  # change day itself
    assert targets_for_date(snaps, date(2026, 10, 19), PROFILE).calories == 2100
    assert targets_for_date(snaps, date(2026, 10, 28), PROFILE).calories == 1900


def test_days_before_first_snapshot_use_earliest_and_are_approximate():
    snaps = [snap("2026-10-10", 2100)]
    t = targets_for_date(snaps, date(2026, 9, 1), PROFILE)
    assert t.calories == 2100
    assert t.is_approximate is True


def test_backfilled_row_is_flagged_approximate_but_real_history_is_not():
    snaps = [snap("2026-09-01", 2000, backfill=True), snap("2026-10-10", 2100)]
    assert targets_for_date(snaps, date(2026, 9, 20), PROFILE).is_approximate is True
    assert targets_for_date(snaps, date(2026, 10, 12), PROFILE).is_approximate is False


def test_no_snapshots_falls_back_to_profile_as_approximate():
    t = targets_for_date([], date(2026, 10, 1), PROFILE)
    assert t.calories == 2000 and t.is_approximate is True


def test_unsorted_snapshots_are_handled():
    snaps = [snap("2026-10-20", 1900), snap("2026-10-01", 2400)]
    assert targets_for_date(snaps, date(2026, 10, 5), PROFILE).calories == 2400


def test_macro_status_bands():
    assert macro_status(0, 2000) == NONE  # unlogged day is never "too low"
    assert macro_status(1000, 2000) == LOW
    assert macro_status(1800, 2000) == OK  # exactly -10% is inside the band
    assert macro_status(2200, 2000) == OK  # exactly +10% is inside the band
    assert macro_status(2201, 2000) == HIGH
    assert macro_status(100, None) == NONE
    assert macro_status(100, 0) == NONE

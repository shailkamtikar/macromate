"""Unit tests for the deterministic water-removal planner — pure logic, no
database, no network."""

from app.domain.water import plan_water_removal


def _log(id_: str, volume_ml: float, logged_at: str) -> dict:
    return {"id": id_, "volume_ml": volume_ml, "logged_at": logged_at}


def test_removing_from_empty_day_is_a_no_op():
    plan = plan_water_removal([], 250)
    assert plan.delete_ids == ()
    assert plan.adjust is None
    assert plan.removed_ml == 0


def test_zero_or_negative_amount_is_a_no_op():
    logs = [_log("1", 250, "2026-01-01T10:00:00+00:00")]
    assert plan_water_removal(logs, 0).delete_ids == ()
    assert plan_water_removal(logs, -100).delete_ids == ()


def test_exact_match_deletes_the_single_log():
    logs = [_log("1", 250, "2026-01-01T10:00:00+00:00")]
    plan = plan_water_removal(logs, 250)
    assert plan.delete_ids == ("1",)
    assert plan.adjust is None
    assert plan.removed_ml == 250


def test_removes_the_most_recently_logged_glass_first():
    logs = [
        _log("first", 250, "2026-01-01T09:00:00+00:00"),
        _log("second", 250, "2026-01-01T10:00:00+00:00"),
    ]
    plan = plan_water_removal(logs, 250)
    assert plan.delete_ids == ("second",)
    assert plan.removed_ml == 250


def test_partial_log_is_reduced_not_deleted():
    # A 500ml bottle logged, then a 250ml "glass" is subtracted — the
    # bottle's row should shrink to 250ml remaining, not disappear.
    logs = [_log("bottle", 500, "2026-01-01T10:00:00+00:00")]
    plan = plan_water_removal(logs, 250)
    assert plan.delete_ids == ()
    assert plan.adjust == ("bottle", 250)
    assert plan.removed_ml == 250


def test_removal_spans_multiple_logs_newest_first():
    logs = [
        _log("a", 100, "2026-01-01T08:00:00+00:00"),
        _log("b", 100, "2026-01-01T09:00:00+00:00"),
        _log("c", 100, "2026-01-01T10:00:00+00:00"),
    ]
    # Removing 250ml should fully consume c and b (newest first) and take
    # 50ml off a, leaving a's row at 50ml.
    plan = plan_water_removal(logs, 250)
    assert set(plan.delete_ids) == {"c", "b"}
    assert plan.adjust == ("a", 50)
    assert plan.removed_ml == 250


def test_cannot_go_below_zero_removes_only_what_exists():
    logs = [_log("1", 100, "2026-01-01T10:00:00+00:00")]
    plan = plan_water_removal(logs, 250)
    assert plan.delete_ids == ("1",)
    assert plan.adjust is None
    # Only 100ml actually existed to remove, even though 250ml was requested.
    assert plan.removed_ml == 100


def test_unordered_input_logs_are_still_sorted_newest_first():
    # Logs arrive out of order (e.g. not pre-sorted by the caller) — the
    # planner must sort internally rather than trust input order.
    logs = [
        _log("second", 250, "2026-01-01T10:00:00+00:00"),
        _log("first", 250, "2026-01-01T09:00:00+00:00"),
    ]
    plan = plan_water_removal(logs, 250)
    assert plan.delete_ids == ("second",)

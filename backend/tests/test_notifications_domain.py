from datetime import time

from app.domain.notifications import evaluate_triggers


def _base_kwargs(**overrides):
    kwargs = dict(
        now_time=time(9, 5),
        logging_reminders_enabled=True,
        reminder_times=[time(9, 0)],
        streak_warnings_enabled=True,
        macro_nudges_enabled=True,
        quiet_hours_start=None,
        quiet_hours_end=None,
        has_logged_anything_today=False,
        current_streak_days=5,
        hours_until_midnight=12,
        remaining_protein_g=20,
        target_protein_g=150,
    )
    kwargs.update(overrides)
    return kwargs


def test_logging_reminder_fires_within_window_after_reminder_time():
    triggers = evaluate_triggers(**_base_kwargs())
    kinds = [t.kind for t in triggers]
    assert "logging_reminder" in kinds


def test_logging_reminder_does_not_fire_before_reminder_time():
    triggers = evaluate_triggers(**_base_kwargs(now_time=time(8, 0)))
    assert all(t.kind != "logging_reminder" for t in triggers)


def test_logging_reminder_does_not_fire_if_already_logged():
    triggers = evaluate_triggers(**_base_kwargs(has_logged_anything_today=True))
    assert all(t.kind != "logging_reminder" for t in triggers)


def test_streak_at_risk_fires_late_in_day_with_active_streak():
    triggers = evaluate_triggers(
        **_base_kwargs(hours_until_midnight=2, has_logged_anything_today=False, now_time=time(22, 0))
    )
    kinds = [t.kind for t in triggers]
    assert "streak_at_risk" in kinds


def test_streak_at_risk_does_not_fire_with_no_streak():
    triggers = evaluate_triggers(
        **_base_kwargs(hours_until_midnight=2, current_streak_days=0, now_time=time(22, 0))
    )
    assert all(t.kind != "streak_at_risk" for t in triggers)


def test_macro_nudge_fires_when_close_to_protein_goal():
    triggers = evaluate_triggers(**_base_kwargs(remaining_protein_g=15, now_time=time(14, 0)))
    kinds = [t.kind for t in triggers]
    assert "macro_close_to_goal" in kinds


def test_macro_nudge_does_not_fire_when_far_from_goal():
    triggers = evaluate_triggers(**_base_kwargs(remaining_protein_g=140, now_time=time(14, 0)))
    assert all(t.kind != "macro_close_to_goal" for t in triggers)


def test_quiet_hours_suppresses_everything():
    triggers = evaluate_triggers(
        **_base_kwargs(now_time=time(23, 0), quiet_hours_start=time(22, 0), quiet_hours_end=time(7, 0))
    )
    assert triggers == []


def test_quiet_hours_wrapping_midnight():
    triggers = evaluate_triggers(
        **_base_kwargs(now_time=time(2, 0), quiet_hours_start=time(22, 0), quiet_hours_end=time(7, 0))
    )
    assert triggers == []


def test_disabled_settings_suppress_their_category():
    triggers = evaluate_triggers(
        **_base_kwargs(logging_reminders_enabled=False, streak_warnings_enabled=False, macro_nudges_enabled=False)
    )
    assert triggers == []


def test_master_switch_suppresses_every_category_even_when_individually_enabled():
    triggers = evaluate_triggers(**_base_kwargs(notifications_enabled=False))
    assert triggers == []

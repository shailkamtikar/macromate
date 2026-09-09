"""Deterministic notification-trigger evaluation (PRD §3.4). Given a user's
settings and their current real state, decides which notifications SHOULD
fire right now. Delivery (actually sending a push) is a separate concern —
see app/core/fcm.py — kept apart so this logic is fully testable without
any external service.
"""

from dataclasses import dataclass
from datetime import time


@dataclass(frozen=True)
class NotificationTrigger:
    kind: str  # "logging_reminder" | "streak_at_risk" | "macro_close_to_goal"
    title: str
    body: str


def _in_quiet_hours(now: time, quiet_start: time | None, quiet_end: time | None) -> bool:
    if quiet_start is None or quiet_end is None:
        return False
    if quiet_start <= quiet_end:
        return quiet_start <= now <= quiet_end
    # Wraps past midnight, e.g. 22:00 -> 07:00.
    return now >= quiet_start or now <= quiet_end


def evaluate_triggers(
    *,
    now_time: time,
    logging_reminders_enabled: bool,
    reminder_times: list[time],
    streak_warnings_enabled: bool,
    macro_nudges_enabled: bool,
    quiet_hours_start: time | None,
    quiet_hours_end: time | None,
    has_logged_anything_today: bool,
    current_streak_days: int,
    hours_until_midnight: float,
    remaining_protein_g: int,
    target_protein_g: int,
) -> list[NotificationTrigger]:
    if _in_quiet_hours(now_time, quiet_hours_start, quiet_hours_end):
        return []

    triggers: list[NotificationTrigger] = []

    if logging_reminders_enabled and not has_logged_anything_today:
        for reminder_time in reminder_times:
            # Fire once the reminder time has passed for the day, within a
            # 15-minute window so this evaluator can run on a periodic job
            # without needing exact-second precision.
            reminder_minutes = reminder_time.hour * 60 + reminder_time.minute
            now_minutes = now_time.hour * 60 + now_time.minute
            if 0 <= now_minutes - reminder_minutes < 15:
                triggers.append(
                    NotificationTrigger(
                        kind="logging_reminder",
                        title="Don't forget to log!",
                        body="You haven't logged anything yet today.",
                    )
                )
                break

    if (
        streak_warnings_enabled
        and current_streak_days >= 2
        and not has_logged_anything_today
        and hours_until_midnight <= 3
    ):
        triggers.append(
            NotificationTrigger(
                kind="streak_at_risk",
                title="Your streak is at risk!",
                body=f"Log something before midnight to keep your {current_streak_days}-day streak!",
            )
        )

    if macro_nudges_enabled and target_protein_g > 0:
        gap = remaining_protein_g
        # Nudge when close-but-not-there: a meaningful gap remains, but
        # it's a realistic single-food close (PRD example: "20g protein
        # away"), not immediately after onboarding with the full target
        # remaining.
        if 0 < gap <= 25 and gap < target_protein_g:
            triggers.append(
                NotificationTrigger(
                    kind="macro_close_to_goal",
                    title="Almost there!",
                    body=f"You're {gap}g protein away from your goal today!",
                )
            )

    return triggers

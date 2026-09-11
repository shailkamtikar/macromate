"""Deterministic hydration math.

Removing water is a *correction*, not a deletion of arbitrary history: the
user tapped "−" on the glass tracker because they logged a glass they
didn't actually drink. This module decides exactly which of today's water
logs that correction consumes, so the router stays a thin transport layer
and the rule ("subtract exactly one container's worth, newest first, never
below zero") is unit-testable without a database.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class WaterRemovalPlan:
    """Which of today's logs a "remove one container" action consumes.

    `delete_ids` are logs fully absorbed by the removal. `adjust` is the
    single partially-absorbed log, reduced to its remaining volume rather
    than deleted — that happens when the user logged a 500 ml bottle and
    then subtracts a 250 ml glass. `removed_ml` is what was actually taken
    off the day's total, which is less than requested when the day holds
    less than one container.
    """

    delete_ids: tuple[str, ...] = ()
    adjust: tuple[str, float] | None = None
    removed_ml: float = 0.0


# Residual volumes below this are treated as zero — floating-point noise,
# not a real sip of water worth keeping a row for.
_EPSILON_ML = 1e-6


def plan_water_removal(
    logs: list[dict], amount_ml: float
) -> WaterRemovalPlan:
    """Plan the removal of `amount_ml` from `logs` (today's water logs).

    Logs are consumed newest-first, which is what "undo the glass I just
    logged" means to the user. The day's total can never go below zero: if
    the day holds less than `amount_ml`, everything is removed and
    `removed_ml` reports the smaller amount actually taken.
    """
    if amount_ml <= 0:
        return WaterRemovalPlan()

    newest_first = sorted(logs, key=lambda row: row["logged_at"], reverse=True)

    remaining = amount_ml
    delete_ids: list[str] = []
    adjust: tuple[str, float] | None = None

    for row in newest_first:
        if remaining <= _EPSILON_ML:
            break
        volume = float(row["volume_ml"])
        if volume <= remaining + _EPSILON_ML:
            delete_ids.append(row["id"])
            remaining -= volume
        else:
            adjust = (row["id"], volume - remaining)
            remaining = 0.0
            break

    return WaterRemovalPlan(
        delete_ids=tuple(delete_ids),
        adjust=adjust,
        removed_ml=amount_ml - max(remaining, 0.0),
    )

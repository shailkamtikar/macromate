"""Deterministic "What to Eat Next" candidate scoring (PRD §3.5).

Smart Suggestions answers "what's a good thing I could eat right now to help
close my remaining macro gap?" -- NOT "find a food whose calories exactly
equal what's left today". A candidate is scored on how well it fits the
remaining budget; it is only ever dropped outright when it would be a
genuinely unreasonable amount of food for what's left (see
is_reasonable_for_remaining), never merely because it doesn't consume the
entire remaining budget by itself.

This module is pure and DB-free by design (matches app/domain/macros.py and
app/domain/progress.py) so the ranking behavior is unit-testable without a
live Supabase connection -- app/routers/suggestions.py is responsible for
fetching the candidate pool (a global eligible-foods RPC plus the requesting
user's own recent/frequent food_logs, see that router for the privacy
reasoning) and handing it to rank_candidates here.
"""

from dataclasses import dataclass

# A candidate's calories may exceed the remaining budget by up to this
# multiple before it's dropped as "genuinely unreasonable" for what's left
# today -- e.g. a 5000 kcal "feast" must never be suggested against a 2200
# kcal remaining budget. REASONABLE_CALORIE_FLOOR covers a near-zero or
# small remaining budget so an ordinary small snack/meal can still be
# suggested rather than the multiplier excluding everything.
REASONABLE_CALORIE_MULTIPLIER = 1.5
REASONABLE_CALORIE_FLOOR = 400

# The fraction of the remaining calorie budget a "reasonable next
# meal/snack" ideally uses -- not a target the food must hit exactly, just
# the center of the calorie-fit curve below. About a third of what's left
# reads as a sensible next thing to eat without needing to single-handedly
# finish the whole day's remaining budget.
IDEAL_CALORIE_FRACTION_OF_REMAINING = 0.35

# Relative weights in the final score -- protein dominates when it's
# genuinely the priority (matches the previous "lead with protein density"
# behavior), calorie fit is a real but secondary signal, and personalization
# / verified are small, deterministic tiebreakers rather than the main
# driver of ranking.
PROTEIN_WEIGHT = 2.0
CALORIE_FIT_WEIGHT = 1.0
PERSONAL_HISTORY_BONUS = 0.3
VERIFIED_BONUS = 0.1


@dataclass(frozen=True)
class SuggestionCandidate:
    id: str
    name: str
    brand: str | None
    serving_description: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    verified: bool
    # True when this candidate came from the requesting user's own
    # recent/frequent food logs rather than the shared/global eligible pool
    # -- a concrete personalization signal ("a food they already actually
    # eat"), not a privacy-relevant flag (both sources are already
    # privacy-filtered before reaching this function).
    is_personal_history: bool = False


def is_reasonable_for_remaining(calories: float, remaining_calories: int) -> bool:
    """A candidate is excluded outright only when its calories are
    genuinely unreasonable for what's left today -- never merely because it
    doesn't exactly fill the remaining budget by itself."""
    if calories <= 0:
        return False
    ceiling = max(remaining_calories * REASONABLE_CALORIE_MULTIPLIER, REASONABLE_CALORIE_FLOOR)
    return calories <= ceiling


def _calorie_fit_score(calories: float, remaining_calories: int) -> float:
    """1.0 at the ideal fraction of the remaining budget, falling off
    linearly on both sides -- never negative. A food using none of the
    remaining budget or wildly more than it both score low, but nothing
    here excludes a candidate; it only affects ranking order."""
    if remaining_calories <= 0:
        return 0.0
    ratio = calories / remaining_calories
    distance = abs(ratio - IDEAL_CALORIE_FRACTION_OF_REMAINING)
    return max(0.0, 1.0 - distance)


def _protein_score(protein_g: float, remaining_protein_g: int, protein_is_priority: bool) -> float:
    """Only rewards protein when the caller has determined protein is
    genuinely still a real gap -- otherwise a user who already hit their
    protein target would keep seeing protein-dense foods pushed at them for
    no reason (matches the pre-existing protein_is_priority semantics)."""
    if not protein_is_priority or remaining_protein_g <= 0:
        return 0.0
    return min(protein_g / remaining_protein_g, 1.0)


def score_candidate(
    candidate: SuggestionCandidate,
    remaining_calories: int,
    remaining_protein_g: int,
    protein_is_priority: bool,
) -> float:
    score = _protein_score(candidate.protein_g, remaining_protein_g, protein_is_priority) * PROTEIN_WEIGHT
    score += _calorie_fit_score(candidate.calories, remaining_calories) * CALORIE_FIT_WEIGHT
    if candidate.is_personal_history:
        score += PERSONAL_HISTORY_BONUS
    if candidate.verified:
        score += VERIFIED_BONUS
    return score


def rank_candidates(
    candidates: list[SuggestionCandidate],
    remaining_calories: int,
    remaining_protein_g: int,
    protein_is_priority: bool,
    limit: int = 3,
) -> list[SuggestionCandidate]:
    """Drops genuinely-unreasonable candidates, scores the rest, and
    returns the top `limit` -- a small ranked set, not an exact-fit search.
    Deterministic: ties break on id so the order never depends on
    incidental database/dict ordering."""
    reasonable = [c for c in candidates if is_reasonable_for_remaining(c.calories, remaining_calories)]
    scored = [
        (score_candidate(c, remaining_calories, remaining_protein_g, protein_is_priority), c)
        for c in reasonable
    ]
    scored.sort(key=lambda pair: (-pair[0], pair[1].id))
    return [c for _, c in scored[:limit]]

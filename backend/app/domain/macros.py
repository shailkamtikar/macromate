"""Deterministic nutrition math: BMI, BMR/TDEE, calorie targets, macro splits,
and remaining-macro calculations.

This module is the single source of truth for every number MacroMate shows a
user or hands to the AI layer for phrasing (PRD §3.3, §3.5). It must stay
pure and dependency-free so it's trivially unit-testable and so the chatbot
never has to (and never should) compute nutrition numbers itself — it only
narrates numbers this module already computed.

Pipeline (see calculate_recommended_calories / macros_for_calories):

    USER PROFILE -> BMR -> TDEE -> GOAL/RATE -> CALORIE TARGET
                 -> PROTEIN -> FAT -> CARBS = REMAINING CALORIES

Calories are always the primary, authoritative target. Protein and fat are
computed from body weight (not as a percentage of calories), then carbs
absorb whatever's left — so protein*4 + carbs*4 + fat*9 always reconciles
with the calorie target within a small rounding tolerance
(MACRO_RECONCILIATION_TOLERANCE_KCAL), never independently drifting from it.
"""

from dataclasses import dataclass
from enum import Enum


class BiologicalSex(str, Enum):
    """Input to the Mifflin-St Jeor BMR formula, which differs by sex."""

    MALE = "male"
    FEMALE = "female"


class ActivityLevel(str, Enum):
    SEDENTARY = "sedentary"
    LIGHT = "light"
    MODERATE = "moderate"
    ACTIVE = "active"
    VERY_ACTIVE = "very_active"


class Goal(str, Enum):
    CUT = "cut"
    MAINTAIN = "maintain"
    BULK = "bulk"


_ACTIVITY_MULTIPLIERS: dict[ActivityLevel, float] = {
    ActivityLevel.SEDENTARY: 1.2,
    ActivityLevel.LIGHT: 1.375,
    ActivityLevel.MODERATE: 1.55,
    ActivityLevel.ACTIVE: 1.725,
    ActivityLevel.VERY_ACTIVE: 1.9,
}

# Legacy fixed calorie adjustment used only when a cut/bulk request omits
# rate_kg_per_week entirely (kept for backward compatibility with older
# clients). Still routed through the same feasibility policy below as any
# rate-derived adjustment — see _resolve_energy_change.
_GOAL_CALORIE_ADJUSTMENT: dict[Goal, int] = {
    Goal.CUT: -500,
    Goal.MAINTAIN: 0,
    Goal.BULK: 300,
}

# Standard estimate: ~7700 kcal of deficit/surplus per kg of body weight
# change (the widely-cited "3500 kcal per lb" rule converted to kg). Used
# ONLY to translate a target weekly rate into a starting daily calorie
# adjustment — real-world weight change is noisy and non-linear, so
# Progress always tracks actual logged weight rather than assuming this
# holds exactly (see calculate_remaining_macros / the Progress domain).
KG_PER_WEEK_TO_DAILY_KCAL = 7700 / 7

# Rate choices surfaced in onboarding/profile. Loss is capped at 1 kg/week —
# already the generally-accepted safe upper bound for sustainable fat loss.
# Gain is offered as a single "lean bulk" rate to limit fat gain, per PRD.
CUT_RATE_OPTIONS_KG_PER_WEEK: tuple[float, ...] = (0.5, 0.75, 1.0)
BULK_RATE_OPTIONS_KG_PER_WEEK: tuple[float, ...] = (0.25,)
MAX_CUT_RATE_KG_PER_WEEK = 1.0
MAX_BULK_RATE_KG_PER_WEEK = 0.5  # server-side ceiling; UI only ever offers 0.25

# ---------------------------------------------------------------------------
# Deficit/surplus feasibility policy (sections 3-8 of the calorie-engine
# spec). A requested rate is honored in full UNLESS it would create a
# deficit/surplus larger than either of these two independent limits, in
# which case the SMALLER of the two limits is applied instead and the
# caller is told the rate was capped (see _resolve_energy_change). This
# replaces the old design, where a *recommended-calorie floor derived from
# BMR* silently absorbed the difference between rates — since a typical
# adult's BMR is usually higher than tdee-minus-any-of-these-deficits, that
# floor ended up being the thing that actually determined the number for
# most sedentary/lightly-active users, making all three cut rates collapse
# to the same value (round(bmr)) instead of ever differing. There is no
# BMR-based floor anymore; MIN_SAFE_DAILY_CALORIES below is now a flat,
# rarely-binding backstop, not a per-user moving target.
#
# - MAX_DEFICIT_FRACTION_OF_TDEE: never remove more than this share of TDEE
#   as a deficit. 40% keeps a "1 kg/week" (~1100 kcal/day) request feasible
#   for anyone with a moderately high TDEE, while still capping it hard for
#   a low-TDEE profile where a 1100 kcal deficit would be extreme.
# - MAX_WEEKLY_LOSS_PERCENT_OF_BODYWEIGHT: never target losing more than
#   this percentage of body weight per week, converted to an equivalent
#   deficit via KG_PER_WEEK_TO_DAILY_KCAL. General guidance cites ~0.5-1.0%
#   bodyweight/week as the typically-recommended range; this cap is set a
#   little above that band (rather than exactly at it) specifically because
#   a request just over 1% for a given body size should not be blindly
#   rejected — this is a genuine feasibility backstop for smaller-bodied
#   users requesting an aggressive rate, not a rejection of every profile
#   that exceeds the "typically recommended" band.
#   IMPORTANT: this number is an internal feasibility/safety threshold used
#   only to decide when to cap a *requested* rate — it is not a clinical
#   claim that 1.5% bodyweight/week (or any other rate this policy accepts)
#   is "healthy" or medically appropriate for any given person. Nothing in
#   this module or the API it backs should be read, displayed, or narrated
#   as medical clearance; a target passing this check only means the app
#   didn't need to reduce it further, not that a professional has reviewed
#   it. Wording shown to the user (see _resolve_energy_change's
#   cap_explanation, and low_calorie_warning below) must stay in those
#   terms — "larger deficit than we recommend for this profile", never
#   "safe" or "healthy".
# - MAX_SURPLUS_FRACTION_OF_TDEE: the analogous, more generous ceiling for
#   a bulk surplus — gaining weight too fast isn't a health-risk in the same
#   sense a large deficit is, but the same feasibility framework still
#   applies for a very-low-TDEE profile per the spec's explicit request.
MAX_DEFICIT_FRACTION_OF_TDEE = 0.40
MAX_WEEKLY_LOSS_PERCENT_OF_BODYWEIGHT = 1.5
MAX_SURPLUS_FRACTION_OF_TDEE = 0.25

# Absolute, flat safety floor for a daily calorie target — a last-resort
# backstop, not the calculation itself. Should essentially never bind
# except for a genuinely very-low-TDEE profile requesting any real deficit
# at all (see calculate_recommended_calories). 1200 kcal/day is a
# widely-cited minimum for adults.
MIN_SAFE_DAILY_CALORIES = 1200

# Below this, a calculated/final calorie target gets a calm, non-medical
# advisory (see low_calorie_warning) — informational, never a silent
# substitution and never a hard rejection by itself.
LOW_CALORIE_WARNING_THRESHOLD = 1500

# A user may nudge the recommended calorie target up/down by at most this
# many kcal — enough to matter, not enough to silently create an unsafe or
# nonsensical target. This is a product/UX bound on the *manual override*,
# independent of MIN_SAFE_DAILY_CALORIES / LOW_CALORIE_WARNING_THRESHOLD.
CALORIE_OVERRIDE_TOLERANCE_KCAL = 500

# Custom macros' implied calories (protein*4 + carbs*4 + fat*9) must land
# within this fraction of the selected calorie target as an initial sanity
# check on the user's raw input (see validate_custom_macros); carbs are
# still recalculated as the exact remainder afterward either way.
MACRO_CALORIE_TOLERANCE_PCT = 0.05

# ---------------------------------------------------------------------------
# Macro engine (sections 9-12). Protein and fat are anchored to body weight
# (g/kg/day), not to a percentage of calories — a person doesn't need more
# protein just because they chose a higher calorie target, and this is what
# keeps protein from silently drifting for no nutritional reason. The only
# time either one moves off its natural per-kg value is the explicit
# feasibility cap below, which engages only when the calorie target is
# genuinely too small to fit it.
#
# Ranges kept deliberately inside ordinary, evidence-informed bounds
# (1.2-2.0 g/kg protein, 0.6-1.0 g/kg fat) rather than extreme
# bodybuilding-level figures:
#   protein: cut 1.8 g/kg (top of the 1.6-2.0 g/kg cut band, to help
#            preserve lean mass in a deficit), maintain 1.4 g/kg and
#            bulk 1.6 g/kg (both within the 1.2-1.6 g/kg band, bulk at the
#            higher end to support muscle-building).
#   fat:     cut 0.8, maintain 0.9, bulk 1.0 g/kg — all within 0.6-1.0 g/kg.
# Not modulated by activity level in this iteration: the per-goal range
# already reasonably covers sedentary-to-active individuals, and adding a
# second multiplier here would be another axis to keep in sync for no
# clearly-evidenced benefit at MacroMate's current scope.
_PROTEIN_G_PER_KG: dict[Goal, float] = {
    Goal.CUT: 1.8,
    Goal.MAINTAIN: 1.4,
    Goal.BULK: 1.6,
}

_FAT_G_PER_KG: dict[Goal, float] = {
    Goal.CUT: 0.8,
    Goal.MAINTAIN: 0.9,
    Goal.BULK: 1.0,
}

# Protein is never allowed to consume more than this share of the calorie
# target, regardless of body weight — the guard against "protein alone
# consuming essentially the entire calorie budget" on an unusually low
# target (or for an unusually heavy user).
_MAX_PROTEIN_CALORIE_FRACTION = 0.40

# Agreed rounding tolerance for "do the macros reconcile with the calorie
# target" checks (both in tests and, in principle, anywhere the app wants
# to assert this invariant). Actual worst-case rounding noise from
# converting the final remainder to whole grams is at most ~2 kcal; this
# leaves a little headroom.
MACRO_RECONCILIATION_TOLERANCE_KCAL = 3

BMI_CATEGORIES: tuple[tuple[float, str], ...] = (
    (18.5, "underweight"),
    (25.0, "healthy"),
    (30.0, "overweight"),
    (float("inf"), "obese"),
)


@dataclass(frozen=True)
class MacroTargets:
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int


@dataclass(frozen=True)
class RemainingMacros:
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int


def calculate_bmi(weight_kg: float, height_cm: float) -> float:
    if weight_kg <= 0 or height_cm <= 0:
        raise ValueError("weight_kg and height_cm must be positive")
    height_m = height_cm / 100
    return round(weight_kg / (height_m**2), 1)


def bmi_category(bmi: float) -> str:
    for threshold, label in BMI_CATEGORIES:
        if bmi < threshold:
            return label
    return BMI_CATEGORIES[-1][1]


def calculate_bmr(
    weight_kg: float, height_cm: float, age_years: int, sex: BiologicalSex
) -> float:
    """Mifflin-St Jeor equation."""
    if age_years <= 0:
        raise ValueError("age_years must be positive")
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age_years
    return base + (5 if sex is BiologicalSex.MALE else -161)


def calculate_tdee(bmr: float, activity_level: ActivityLevel) -> float:
    return bmr * _ACTIVITY_MULTIPLIERS[activity_level]


def calorie_adjustment_for_rate(goal: Goal, rate_kg_per_week: float) -> int:
    """Daily calorie adjustment implied by a target weekly weight-change
    rate, from the energy-equivalent relationship alone (~7700 kcal/kg) —
    signed (negative for cut, positive for bulk), *before* the feasibility
    policy in _resolve_energy_change is applied. Bounded per goal so a
    caller can't request an obviously unsafe rate in the first place."""
    if goal is Goal.MAINTAIN:
        return 0
    if goal is Goal.CUT:
        if not (0 < rate_kg_per_week <= MAX_CUT_RATE_KG_PER_WEEK):
            raise ValueError(
                f"Weight-loss rate must be between 0 and {MAX_CUT_RATE_KG_PER_WEEK} kg/week"
            )
        return -round(rate_kg_per_week * KG_PER_WEEK_TO_DAILY_KCAL)
    if goal is Goal.BULK:
        if not (0 < rate_kg_per_week <= MAX_BULK_RATE_KG_PER_WEEK):
            raise ValueError(
                f"Weight-gain rate must be between 0 and {MAX_BULK_RATE_KG_PER_WEEK} kg/week"
            )
        return round(rate_kg_per_week * KG_PER_WEEK_TO_DAILY_KCAL)
    raise ValueError(f"Unknown goal: {goal}")


def low_calorie_warning(calories: int) -> str | None:
    """A calm, non-medical advisory for a calculated/final calorie target
    that's unusually low — informational only. Never used to silently
    replace the number; the caller still shows `calories` honestly."""
    if calories < LOW_CALORIE_WARNING_THRESHOLD:
        return (
            "Your estimated intake is unusually low for this profile. Consider choosing a "
            "slower rate or discussing your target with a qualified healthcare professional."
        )
    return None


def _resolve_energy_change(
    goal: Goal,
    tdee: float,
    weight_kg: float,
    requested_rate_kg_per_week: float | None,
) -> tuple[float, float | None, float | None, bool, str | None, str | None]:
    """The feasibility policy at the heart of sections 3-8: decides how much
    of a requested deficit/surplus to actually apply.

    Returns (applied_energy_change_kcal, requested_rate, applied_rate,
    is_capped, cap_reason, cap_explanation). `applied_energy_change_kcal` is
    signed: negative for a cut, positive for a bulk, exactly 0 for maintain.
    """
    if goal is Goal.MAINTAIN:
        return 0.0, None, None, False, None, None

    if requested_rate_kg_per_week is not None:
        requested_rate: float | None = requested_rate_kg_per_week
        requested_change = calorie_adjustment_for_rate(goal, requested_rate_kg_per_week)
    else:
        # Legacy fallback for a caller that omits rate_kg_per_week entirely
        # — still routed through the same feasibility policy below.
        requested_rate = None
        requested_change = _GOAL_CALORIE_ADJUSTMENT[goal]

    requested_magnitude = abs(requested_change)

    if goal is Goal.CUT:
        max_from_tdee = tdee * MAX_DEFICIT_FRACTION_OF_TDEE
        max_rate_from_bodyweight = weight_kg * (MAX_WEEKLY_LOSS_PERCENT_OF_BODYWEIGHT / 100)
        max_from_bodyweight = max_rate_from_bodyweight * KG_PER_WEEK_TO_DAILY_KCAL
        if max_from_tdee <= max_from_bodyweight:
            policy_max, policy_reason = max_from_tdee, "tdee_fraction"
        else:
            policy_max, policy_reason = max_from_bodyweight, "bodyweight_percent"
    else:  # BULK
        policy_max, policy_reason = tdee * MAX_SURPLUS_FRACTION_OF_TDEE, "tdee_fraction"

    if requested_magnitude <= policy_max:
        applied_magnitude = requested_magnitude
        is_capped = False
        cap_reason: str | None = None
    else:
        applied_magnitude = policy_max
        is_capped = True
        cap_reason = policy_reason

    sign = -1 if goal is Goal.CUT else 1
    applied_change = sign * applied_magnitude
    applied_rate = round(applied_magnitude / KG_PER_WEEK_TO_DAILY_KCAL, 2)

    cap_explanation = None
    if is_capped:
        verb = "deficit" if goal is Goal.CUT else "surplus"
        cap_explanation = (
            f"Your requested rate would require a larger {verb} than we recommend for this "
            "profile, so we've limited the calculated target."
        )

    return applied_change, requested_rate, applied_rate, is_capped, cap_reason, cap_explanation


@dataclass(frozen=True)
class RecommendedCalories:
    calories: int
    bmr: int
    tdee: int
    #: Identical to `tdee` — exposed explicitly since maintenance calories
    #: (section 2: no cut/bulk adjustment at all) is a distinct, named
    #: concept the UI shows next to the goal-adjusted `calories`.
    maintenance_calories: int
    requested_rate_kg_per_week: float | None
    applied_rate_kg_per_week: float | None
    is_rate_capped: bool
    cap_reason: str | None
    cap_explanation: str | None
    #: Signed: negative for a cut, positive for a bulk, 0 for maintain.
    #: Reflects what was *actually* applied (post-cap, post-floor) — not
    #: simply the requested rate's raw energy-equivalent.
    daily_energy_change_kcal: int


def calculate_recommended_calories(
    weight_kg: float,
    height_cm: float,
    age_years: int,
    sex: BiologicalSex,
    activity_level: ActivityLevel,
    goal: Goal,
    rate_kg_per_week: float | None = None,
) -> RecommendedCalories:
    """BMR -> TDEE -> goal/rate-adjusted calories, through the feasibility
    policy in _resolve_energy_change, floored at a safe absolute minimum
    only as a last resort. `rate_kg_per_week` is required for cut/bulk
    (validated by calorie_adjustment_for_rate); omitting it falls back to
    the previous fixed per-goal adjustment for backward compatibility."""
    bmr = calculate_bmr(weight_kg, height_cm, age_years, sex)
    tdee = calculate_tdee(bmr, activity_level)
    maintenance = round(tdee)

    (
        applied_change,
        requested_rate,
        applied_rate,
        is_capped,
        cap_reason,
        cap_explanation,
    ) = _resolve_energy_change(goal, tdee, weight_kg, rate_kg_per_week)

    calories_before_floor = round(tdee + applied_change)
    calories = max(calories_before_floor, MIN_SAFE_DAILY_CALORIES)

    if calories > calories_before_floor:
        # The feasibility-capped (or, for maintain, unadjusted) target still
        # wasn't gentle enough to clear the absolute minimum — this is the
        # one remaining hard floor, and it should essentially only bind for
        # a genuinely very-low-TDEE profile. It overrides whatever the
        # feasibility policy above decided, so it's reported as its own,
        # distinct cap reason rather than silently disguised as the
        # tdee/bodyweight policy's doing.
        is_capped = True
        cap_reason = "absolute_floor"
        applied_rate = (
            None if goal is Goal.MAINTAIN else round((tdee - calories) / KG_PER_WEEK_TO_DAILY_KCAL, 2)
        )
        # Deliberately doesn't call MIN_SAFE_DAILY_CALORIES a "safe" number
        # to the user — it's this app's built-in minimum, not a medical
        # clearance (see the policy note above _MAX_DEFICIT_FRACTION_OF_TDEE).
        cap_explanation = (
            "Your estimated maintenance calories are low enough that even a moderate "
            f"adjustment would fall below this app's built-in minimum of {MIN_SAFE_DAILY_CALORIES} "
            "kcal/day, so we've set your target at that minimum instead."
        )

    return RecommendedCalories(
        calories=calories,
        bmr=round(bmr),
        tdee=round(tdee),
        maintenance_calories=maintenance,
        requested_rate_kg_per_week=requested_rate,
        applied_rate_kg_per_week=applied_rate,
        is_rate_capped=is_capped,
        cap_reason=cap_reason,
        cap_explanation=cap_explanation,
        daily_energy_change_kcal=round(calories - maintenance),
    )


def validate_calorie_override(calories: int, recommended: int) -> None:
    """A user may nudge the recommended target, but not past the absolute
    safety minimum and not by more than the allowed tolerance in either
    direction — prevents silently creating a mathematically-unsafe or
    nonsensical target through the slider/input. This is a *manual-editing*
    guard, independent of any goal/rate feasibility policy — the calculated
    `recommended` value itself is never clamped by this function."""
    if calories < MIN_SAFE_DAILY_CALORIES:
        raise ValueError(
            f"Calorie target can't go below {MIN_SAFE_DAILY_CALORIES} kcal/day."
        )
    if abs(calories - recommended) > CALORIE_OVERRIDE_TOLERANCE_KCAL:
        raise ValueError(
            f"Calorie target can only be adjusted by up to {CALORIE_OVERRIDE_TOLERANCE_KCAL} "
            f"kcal from the recommended {recommended} kcal."
        )


def carbs_from_remainder(target_calories: int, protein_g: float, fat_g: float) -> int:
    """Carbs always receive whatever's left after protein and fat (section
    11) — the calorie target stays authoritative rather than carbs being
    computed independently and merely hoped to reconcile. Never negative."""
    remaining = target_calories - protein_g * 4 - fat_g * 9
    return max(round(remaining / 4), 0)


def validate_custom_macros(
    protein_g: float, carbs_g: float, fat_g: float, target_calories: int
) -> None:
    """Custom macros must roughly add up to the calorie target — rejects
    contradictory input with a specific, actionable message rather than
    silently accepting numbers that don't reconcile. Carbs are still
    recalculated as the exact remainder afterward either way (see
    carbs_from_remainder) — this only validates the user's *raw* three
    numbers as a sanity check, plus the harder protein+fat feasibility
    check below (independent of whatever carbs value was submitted, since
    carbs is about to be overwritten regardless)."""
    if protein_g < 0 or carbs_g < 0 or fat_g < 0:
        raise ValueError("Macro grams can't be negative.")

    implied = protein_g * 4 + carbs_g * 4 + fat_g * 9
    lower = target_calories * (1 - MACRO_CALORIE_TOLERANCE_PCT)
    upper = target_calories * (1 + MACRO_CALORIE_TOLERANCE_PCT)
    if not (lower <= implied <= upper):
        diff = round(implied - target_calories)
        if diff > 0:
            verb, amount = "reduce", diff
        else:
            verb, amount = "increase", -diff
        raise ValueError(
            f"These macros imply {round(implied)} kcal, which is {abs(diff)} kcal "
            f"{'over' if diff > 0 else 'under'} your {target_calories} kcal target. "
            f"Try adjusting protein/carbs/fat to {verb} the total by about {amount} kcal, "
            "or change your calorie target instead."
        )

    protein_and_fat_calories = protein_g * 4 + fat_g * 9
    if protein_and_fat_calories > target_calories:
        overage = round(protein_and_fat_calories - target_calories)
        raise ValueError(
            f"Protein and fat alone already imply {round(protein_and_fat_calories)} kcal, "
            f"which is {overage} kcal over your {target_calories} kcal target before carbs "
            "are even counted. Reduce protein or fat, or raise your calorie target."
        )


def macros_for_calories(calories: int, weight_kg: float, goal: Goal) -> MacroTargets:
    """CALORIES -> PROTEIN -> FAT -> CARBS = REMAINDER (sections 1, 9-12).

    Protein and fat start from their goal's g/kg-bodyweight value (see
    _PROTEIN_G_PER_KG / _FAT_G_PER_KG) — a fixed function of body weight,
    not of the calorie target — so they don't drift just because the user
    picked a different calorie number. The only time either one is reduced
    below that natural value is the explicit feasibility step below, which
    only engages when the calorie target is genuinely too small to fit it:
    protein is capped first (never more than
    _MAX_PROTEIN_CALORIE_FRACTION of the target), then fat is capped to
    whatever's left after protein. Carbs always take the exact remainder,
    which is what guarantees protein*4 + carbs*4 + fat*9 reconciles with
    `calories` within MACRO_RECONCILIATION_TOLERANCE_KCAL — carbs is never
    computed independently as its own percentage.
    """
    protein_g = round(weight_kg * _PROTEIN_G_PER_KG[goal])
    protein_calories = protein_g * 4
    max_protein_calories = calories * _MAX_PROTEIN_CALORIE_FRACTION
    if protein_calories > max_protein_calories:
        protein_g = max(round(max_protein_calories / 4), 0)
        protein_calories = protein_g * 4

    fat_g = round(weight_kg * _FAT_G_PER_KG[goal])
    fat_calories = fat_g * 9
    remaining_for_fat = calories - protein_calories
    if fat_calories > remaining_for_fat:
        fat_calories = max(remaining_for_fat, 0)
        fat_g = round(fat_calories / 9) if fat_calories > 0 else 0

    carbs_g = carbs_from_remainder(calories, protein_g, fat_g)
    return MacroTargets(calories=calories, protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)


def calculate_macro_targets(
    weight_kg: float,
    height_cm: float,
    age_years: int,
    sex: BiologicalSex,
    activity_level: ActivityLevel,
    goal: Goal,
    rate_kg_per_week: float | None = None,
) -> MacroTargets:
    """Full pipeline: BMR -> TDEE -> goal/rate-adjusted calories -> macro
    split."""
    recommended = calculate_recommended_calories(
        weight_kg, height_cm, age_years, sex, activity_level, goal, rate_kg_per_week
    )
    return macros_for_calories(recommended.calories, weight_kg, goal)


def suggested_water_goal_ml(weight_kg: float, activity_level: ActivityLevel) -> int:
    """35 ml/kg bodyweight is a standard general hydration guideline; add a
    flat 500ml for more active levels to account for extra fluid loss.
    Editable by the user afterward (PRD §3.1) — this is only the suggested
    starting value."""
    base = weight_kg * 35
    if activity_level in (ActivityLevel.ACTIVE, ActivityLevel.VERY_ACTIVE):
        base += 500
    return round(base)


def calculate_remaining_macros(
    targets: MacroTargets,
    consumed_calories: int,
    consumed_protein_g: int,
    consumed_carbs_g: int,
    consumed_fat_g: int,
) -> RemainingMacros:
    """Remaining budget for the day, used by both the UI and the food-suggestion
    matcher (PRD §3.5). Never goes negative — over-budget is a UI/coach
    concern, not a math concern."""
    return RemainingMacros(
        calories=max(targets.calories - consumed_calories, 0),
        protein_g=max(targets.protein_g - consumed_protein_g, 0),
        carbs_g=max(targets.carbs_g - consumed_carbs_g, 0),
        fat_g=max(targets.fat_g - consumed_fat_g, 0),
    )

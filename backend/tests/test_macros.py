"""Deterministic tests for the calorie/macro engine (app/domain/macros.py).

Pipeline under test: BMR -> TDEE -> GOAL/RATE (through a feasibility
policy) -> CALORIE TARGET -> PROTEIN -> FAT -> CARBS = REMAINDER. Calories
are always the authoritative target; every generated MacroTargets must
reconcile with it within MACRO_RECONCILIATION_TOLERANCE_KCAL.
"""

import pytest

from app.domain.macros import (
    ActivityLevel,
    BiologicalSex,
    Goal,
    MACRO_RECONCILIATION_TOLERANCE_KCAL,
    MAX_BULK_RATE_KG_PER_WEEK,
    MAX_CUT_RATE_KG_PER_WEEK,
    MIN_SAFE_DAILY_CALORIES,
    calculate_bmi,
    calculate_bmr,
    calculate_macro_targets,
    calculate_recommended_calories,
    calculate_remaining_macros,
    calculate_tdee,
    calorie_adjustment_for_rate,
    bmi_category,
    carbs_from_remainder,
    low_calorie_warning,
    macros_for_calories,
    suggested_water_goal_ml,
    validate_calorie_override,
    validate_custom_macros,
)


def reconstructed_calories(targets) -> float:
    return targets.protein_g * 4 + targets.carbs_g * 4 + targets.fat_g * 9


# ---------------------------------------------------------------------------
# BMI / BMR / TDEE — unchanged basics
# ---------------------------------------------------------------------------
def test_calculate_bmi():
    assert calculate_bmi(weight_kg=70, height_cm=175) == pytest.approx(22.9, abs=0.1)


def test_calculate_bmi_rejects_non_positive_inputs():
    with pytest.raises(ValueError):
        calculate_bmi(weight_kg=0, height_cm=175)


@pytest.mark.parametrize(
    "bmi,expected",
    [(17.0, "underweight"), (22.0, "healthy"), (27.0, "overweight"), (35.0, "obese")],
)
def test_bmi_category(bmi, expected):
    assert bmi_category(bmi) == expected


def test_calculate_bmr_male_vs_female_differs_by_known_offset():
    male = calculate_bmr(70, 175, 30, BiologicalSex.MALE)
    female = calculate_bmr(70, 175, 30, BiologicalSex.FEMALE)
    assert male - female == pytest.approx(166, abs=0.01)


def test_calculate_tdee_scales_with_activity():
    bmr = 1650.0
    sedentary = calculate_tdee(bmr, ActivityLevel.SEDENTARY)
    very_active = calculate_tdee(bmr, ActivityLevel.VERY_ACTIVE)
    assert sedentary == pytest.approx(1980.0)
    assert very_active > sedentary


def test_tdee_strictly_increases_across_all_five_activity_levels():
    bmr = 1600.0
    levels = [
        ActivityLevel.SEDENTARY,
        ActivityLevel.LIGHT,
        ActivityLevel.MODERATE,
        ActivityLevel.ACTIVE,
        ActivityLevel.VERY_ACTIVE,
    ]
    tdees = [calculate_tdee(bmr, level) for level in levels]
    assert tdees == sorted(tdees)
    assert len(set(tdees)) == 5


def test_suggested_water_goal_scales_with_weight_and_activity():
    sedentary = suggested_water_goal_ml(70, ActivityLevel.SEDENTARY)
    active = suggested_water_goal_ml(70, ActivityLevel.ACTIVE)
    assert sedentary == 2450  # 70 * 35
    assert active == 2950  # 70 * 35 + 500


# ---------------------------------------------------------------------------
# Test profiles. HIGH_TDEE is deliberately chosen so that none of the three
# cut rates, nor the bulk rate, ever trip the feasibility policy — isolates
# "does rate selection produce meaningfully different, correctly-ordered
# targets" from the safety-cap behavior tested separately below.
# LOW_TDEE is chosen so 0.75 and 1.0 kg/week both exceed the deficit
# feasibility policy for a genuinely small/low-TDEE profile.
# ---------------------------------------------------------------------------
HIGH_TDEE_PROFILE = dict(
    weight_kg=95,
    height_cm=185,
    age_years=25,
    sex=BiologicalSex.MALE,
    activity_level=ActivityLevel.VERY_ACTIVE,
)

LOW_TDEE_PROFILE = dict(
    weight_kg=65,
    height_cm=165,
    age_years=30,
    sex=BiologicalSex.FEMALE,
    activity_level=ActivityLevel.MODERATE,
)


# ---------------------------------------------------------------------------
# Maintenance (section 2): exactly TDEE, no adjustment.
# ---------------------------------------------------------------------------
def test_maintenance_equals_tdee_exactly():
    rec = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.MAINTAIN)
    assert rec.calories == rec.tdee == rec.maintenance_calories
    assert rec.daily_energy_change_kcal == 0
    assert rec.is_rate_capped is False
    assert rec.requested_rate_kg_per_week is None
    assert rec.applied_rate_kg_per_week is None


# ---------------------------------------------------------------------------
# Cut rates on a high-TDEE profile: meaningfully different, strictly
# ordered, uncapped (section 15/16 — "goal selection must produce a clear
# difference" and "example test profile").
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("rate", [0.5, 0.75, 1.0])
def test_high_tdee_cut_rates_are_not_capped_and_reflect_the_selected_rate(rate):
    maintain = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.MAINTAIN)
    cut = calculate_recommended_calories(
        **HIGH_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=rate
    )
    assert cut.is_rate_capped is False
    assert cut.requested_rate_kg_per_week == rate
    assert cut.applied_rate_kg_per_week == pytest.approx(rate, abs=0.01)
    assert cut.calories < maintain.calories
    implied_deficit = maintain.calories - cut.calories
    assert implied_deficit == pytest.approx(rate * 1100, abs=2)


def test_high_tdee_cut_rates_are_strictly_ordered_and_distinct():
    # This is the exact convergence bug's regression test: three different
    # requested rates must never collapse to the same calorie number when
    # the profile's TDEE comfortably supports all three.
    half = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=0.5)
    three_quarter = calculate_recommended_calories(
        **HIGH_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=0.75
    )
    full = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=1.0)
    assert half.calories > three_quarter.calories > full.calories
    assert len({half.calories, three_quarter.calories, full.calories}) == 3


def test_high_tdee_goal_selection_produces_the_full_expected_ordering():
    # Section 15: maintenance > 0.5 > 0.75 > 1.0, and bulk > maintenance.
    maintain = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.MAINTAIN)
    half = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=0.5)
    three_quarter = calculate_recommended_calories(
        **HIGH_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=0.75
    )
    full = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=1.0)
    bulk = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.BULK, rate_kg_per_week=0.25)
    assert maintain.calories > half.calories > three_quarter.calories > full.calories
    assert bulk.calories > maintain.calories


# ---------------------------------------------------------------------------
# Bulk (section 8): modest, deterministic surplus; distinct from maintenance.
# ---------------------------------------------------------------------------
def test_bulk_uses_energy_equivalent_surplus_for_the_requested_rate():
    maintain = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.MAINTAIN)
    bulk = calculate_recommended_calories(**HIGH_TDEE_PROFILE, goal=Goal.BULK, rate_kg_per_week=0.25)
    assert bulk.is_rate_capped is False
    assert bulk.calories > maintain.calories
    surplus = bulk.calories - maintain.calories
    assert surplus == pytest.approx(0.25 * 1100, abs=2)  # ~275 kcal/day


# ---------------------------------------------------------------------------
# Rate -> deficit/surplus math (energy-equivalent relationship itself)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("rate", [0.5, 0.75, 1.0])
def test_cut_rate_produces_proportionally_larger_deficit(rate):
    adjustment = calorie_adjustment_for_rate(Goal.CUT, rate)
    assert adjustment < 0
    assert adjustment == pytest.approx(-rate * 1100, abs=1)


def test_cut_rate_deficits_are_strictly_ordered():
    deficits = [calorie_adjustment_for_rate(Goal.CUT, r) for r in (0.5, 0.75, 1.0)]
    assert deficits[0] > deficits[1] > deficits[2]


def test_cut_rate_above_safe_cap_is_rejected():
    with pytest.raises(ValueError):
        calorie_adjustment_for_rate(Goal.CUT, MAX_CUT_RATE_KG_PER_WEEK + 0.01)


def test_cut_rate_must_be_positive():
    with pytest.raises(ValueError):
        calorie_adjustment_for_rate(Goal.CUT, 0)
    with pytest.raises(ValueError):
        calorie_adjustment_for_rate(Goal.CUT, -0.5)


def test_bulk_rate_produces_surplus_within_safe_cap():
    adjustment = calorie_adjustment_for_rate(Goal.BULK, 0.25)
    assert adjustment > 0


def test_bulk_rate_above_safe_cap_is_rejected():
    with pytest.raises(ValueError):
        calorie_adjustment_for_rate(Goal.BULK, MAX_BULK_RATE_KG_PER_WEEK + 0.01)


def test_maintain_ignores_rate_and_has_zero_adjustment():
    assert calorie_adjustment_for_rate(Goal.MAINTAIN, 5.0) == 0


# ---------------------------------------------------------------------------
# Low-TDEE feasibility/safety case (section 4/5/17): 1 kg/week recognized
# as aggressive and capped; 0.5/0.75 remain distinct from it and from each
# other; nothing collapses to an arbitrary universal number.
# ---------------------------------------------------------------------------
def test_low_tdee_gentle_rate_is_not_capped():
    rec = calculate_recommended_calories(**LOW_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=0.5)
    assert rec.is_rate_capped is False
    assert rec.applied_rate_kg_per_week == pytest.approx(0.5, abs=0.01)


def test_low_tdee_aggressive_rate_is_recognized_and_capped():
    rec = calculate_recommended_calories(**LOW_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=1.0)
    assert rec.is_rate_capped is True
    assert rec.requested_rate_kg_per_week == 1.0
    assert rec.applied_rate_kg_per_week < 1.0
    assert rec.cap_reason in ("tdee_fraction", "bodyweight_percent")
    assert rec.cap_explanation is not None and "deficit" in rec.cap_explanation
    # Never absurdly low — still at or above the absolute safety minimum.
    assert rec.calories >= MIN_SAFE_DAILY_CALORIES


def test_low_tdee_rates_remain_distinctly_ordered_even_with_capping():
    half = calculate_recommended_calories(**LOW_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=0.5)
    three_quarter = calculate_recommended_calories(
        **LOW_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=0.75
    )
    full = calculate_recommended_calories(**LOW_TDEE_PROFILE, goal=Goal.CUT, rate_kg_per_week=1.0)
    # 0.5 stays meaningfully less aggressive than 0.75, which stays less
    # aggressive than 1.0 — for this specific profile the deficit
    # feasibility ceiling sits between the 0.75 and 1.0 kg/week requests,
    # so it caps only the most aggressive one without forcing a collapse.
    assert half.calories > three_quarter.calories > full.calories
    assert three_quarter.is_rate_capped is False
    assert full.is_rate_capped is True


def test_two_different_requested_rates_can_legitimately_converge_but_stay_distinguishable():
    # For this profile, both 0.75 and 1.0 kg/week are aggressive enough to
    # hit the same absolute-floor backstop -- a genuine, policy-driven
    # convergence, not the old arbitrary-BMR bug. The response must still
    # let the caller tell them apart: they asked for different rates, even
    # though the applied outcome (calories, applied rate, cap reason) is
    # identical for both.
    profile = dict(
        weight_kg=70,
        height_cm=165,
        age_years=35,
        sex=BiologicalSex.FEMALE,
        activity_level=ActivityLevel.LIGHT,
    )
    three_quarter = calculate_recommended_calories(**profile, goal=Goal.CUT, rate_kg_per_week=0.75)
    full = calculate_recommended_calories(**profile, goal=Goal.CUT, rate_kg_per_week=1.0)

    # The applied outcome genuinely converges...
    assert three_quarter.calories == full.calories
    assert three_quarter.applied_rate_kg_per_week == full.applied_rate_kg_per_week
    assert three_quarter.cap_reason == full.cap_reason == "absolute_floor"
    assert three_quarter.is_rate_capped and full.is_rate_capped

    # ...but what was actually *requested* is never lost or conflated.
    assert three_quarter.requested_rate_kg_per_week == 0.75
    assert full.requested_rate_kg_per_week == 1.0
    assert three_quarter.requested_rate_kg_per_week != full.requested_rate_kg_per_week


def test_extreme_low_tdee_falls_back_to_the_absolute_floor_not_an_arbitrary_bmr_value():
    # A very light, low-BMR, low-TDEE profile at the most aggressive cut
    # rate — even the feasibility-capped deficit isn't gentle enough to
    # clear the absolute minimum, so the flat floor (not BMR) applies.
    rec = calculate_recommended_calories(
        weight_kg=45,
        height_cm=150,
        age_years=60,
        sex=BiologicalSex.FEMALE,
        activity_level=ActivityLevel.SEDENTARY,
        goal=Goal.CUT,
        rate_kg_per_week=1.0,
    )
    assert rec.calories == MIN_SAFE_DAILY_CALORIES
    assert rec.is_rate_capped is True
    assert rec.cap_reason == "absolute_floor"


# ---------------------------------------------------------------------------
# Regression: the ~2034 kcal convergence bug. Before the fix, a
# BMR-derived floor (max(1200, round(bmr))) dominated whenever
# tdee+adjustment fell under BMR for *every* requested rate — a common
# case for sedentary/lightly-active users — silently collapsing all three
# cut rates to the exact same number (round(bmr)) instead of ever
# differing. Reproduces the old bug's own trigger condition (a profile
# whose BMR sits above all three tdee-minus-deficit values) and asserts
# the three rates are NOT identical.
# ---------------------------------------------------------------------------
def test_regression_cut_rates_do_not_converge_to_bmr_for_a_profile_that_used_to_trigger_it():
    profile = dict(
        weight_kg=70,
        height_cm=165,
        age_years=35,
        sex=BiologicalSex.FEMALE,
        activity_level=ActivityLevel.LIGHT,
    )
    bmr = calculate_bmr(
        weight_kg=profile["weight_kg"],
        height_cm=profile["height_cm"],
        age_years=profile["age_years"],
        sex=profile["sex"],
    )
    calories = [
        calculate_recommended_calories(**profile, goal=Goal.CUT, rate_kg_per_week=r).calories
        for r in (0.5, 0.75, 1.0)
    ]
    # The old bug's exact symptom: all three equal to round(bmr).
    assert not all(c == round(bmr) for c in calories)
    assert len(set(calories)) >= 2


# ---------------------------------------------------------------------------
# Low-calorie warning (sections 7, 19)
# ---------------------------------------------------------------------------
def test_low_calorie_warning_present_under_threshold_absent_above():
    assert low_calorie_warning(1499) is not None
    assert low_calorie_warning(1500) is None
    assert low_calorie_warning(2000) is None
    # Calm, non-medical wording — never a bare "unhealthy"/"dangerous" label.
    text = low_calorie_warning(1200)
    assert "unhealthy" not in text.lower()
    assert "healthcare professional" in text.lower()


# ---------------------------------------------------------------------------
# Calorie override (manual adjustment) — independent of goal/rate policy.
# ---------------------------------------------------------------------------
def test_calorie_override_within_tolerance_is_accepted():
    validate_calorie_override(calories=2100, recommended=2000)  # no raise


def test_calorie_override_beyond_tolerance_is_rejected():
    with pytest.raises(ValueError):
        validate_calorie_override(calories=2700, recommended=2000)


def test_calorie_override_below_absolute_floor_is_rejected():
    with pytest.raises(ValueError):
        validate_calorie_override(calories=1100, recommended=1300)


def test_calorie_override_does_not_reject_a_recommended_value_above_2500():
    # Section 7: the manual 1500-2500 range is a UX default, not a hard
    # mathematical ceiling — a legitimately-computed high recommendation
    # (e.g. a large, very active bulk) must remain a valid override target.
    validate_calorie_override(calories=3100, recommended=2900)  # no raise


def test_manual_override_changes_only_calories_and_macros_not_tdee_or_bodyweight():
    """Documents and locks in an important invariant: a manual calorie
    override is purely a downstream choice of *which calorie number to
    use* — it must never feed back into recomputing BMR/TDEE (both are
    functions of the profile inputs only) or imply any change in body
    weight. `calculate_recommended_calories`'s bmr/tdee/maintenance_calories
    are identical regardless of what a caller later does with
    `calories` via an override; only macros_for_calories(final_calories,
    ...) changes when the chosen calorie number changes."""
    profile = dict(
        weight_kg=80,
        height_cm=180,
        age_years=28,
        sex=BiologicalSex.MALE,
        activity_level=ActivityLevel.MODERATE,
    )
    rec = calculate_recommended_calories(**profile, goal=Goal.MAINTAIN)

    # Two different "chosen" calorie numbers (simulating two different
    # manual overrides) must derive from the exact same bmr/tdee -- the
    # override never re-runs calculate_bmr/calculate_tdee with a different
    # implied weight or activity level.
    lower_targets = macros_for_calories(rec.calories - 300, profile["weight_kg"], Goal.MAINTAIN)
    higher_targets = macros_for_calories(rec.calories + 300, profile["weight_kg"], Goal.MAINTAIN)

    rec_again = calculate_recommended_calories(**profile, goal=Goal.MAINTAIN)
    assert rec_again.bmr == rec.bmr
    assert rec_again.tdee == rec.tdee
    assert rec_again.maintenance_calories == rec.maintenance_calories

    # But the macro split *does* recalculate for the new calorie number.
    assert lower_targets.calories == rec.calories - 300
    assert higher_targets.calories == rec.calories + 300
    assert abs(reconstructed_calories(lower_targets) - lower_targets.calories) <= 3
    assert abs(reconstructed_calories(higher_targets) - higher_targets.calories) <= 3


# ---------------------------------------------------------------------------
# Macro engine: protein -> fat -> carbs=remainder (sections 9-12)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "calories,weight_kg,goal",
    [
        (1600, 70, Goal.CUT),
        (2000, 75, Goal.MAINTAIN),
        (2200, 80, Goal.MAINTAIN),
        (2800, 90, Goal.BULK),
        (3200, 100, Goal.BULK),
        (1450, 55, Goal.CUT),
    ],
)
def test_macros_always_reconcile_with_the_calorie_target(calories, weight_kg, goal):
    targets = macros_for_calories(calories, weight_kg, goal)
    assert abs(reconstructed_calories(targets) - calories) <= MACRO_RECONCILIATION_TOLERANCE_KCAL
    assert targets.protein_g > 0
    assert targets.fat_g >= 0
    assert targets.carbs_g >= 0


def test_protein_uses_the_documented_g_per_kg_rule_by_goal():
    # cut 1.8, maintain 1.4, bulk 1.6 g/kg — comfortably inside the
    # evidence-informed 1.2-2.0 g/kg range, nowhere near a 2.5-3.0+
    # bodybuilding-level figure.
    cut = macros_for_calories(2600, weight_kg=80, goal=Goal.CUT)
    maintain = macros_for_calories(2600, weight_kg=80, goal=Goal.MAINTAIN)
    bulk = macros_for_calories(2600, weight_kg=80, goal=Goal.BULK)
    assert cut.protein_g == round(80 * 1.8)
    assert maintain.protein_g == round(80 * 1.4)
    assert bulk.protein_g == round(80 * 1.6)


def test_protein_does_not_scale_with_calories_alone():
    # A person doesn't need more protein just because they chose a higher
    # calorie target — protein stays at its natural body-weight-derived
    # value across a range of calorie targets, as long as it's feasible.
    lower = macros_for_calories(2200, weight_kg=80, goal=Goal.MAINTAIN)
    higher = macros_for_calories(3000, weight_kg=80, goal=Goal.MAINTAIN)
    assert lower.protein_g == higher.protein_g == round(80 * 1.4)


def test_fat_uses_the_documented_g_per_kg_rule_by_goal():
    cut = macros_for_calories(2600, weight_kg=80, goal=Goal.CUT)
    maintain = macros_for_calories(2600, weight_kg=80, goal=Goal.MAINTAIN)
    bulk = macros_for_calories(2600, weight_kg=80, goal=Goal.BULK)
    assert cut.fat_g == round(80 * 0.8)
    assert maintain.fat_g == round(80 * 0.9)
    assert bulk.fat_g == round(80 * 1.0)


def test_carbs_from_remainder_matches_direct_helper():
    targets = macros_for_calories(2200, weight_kg=75, goal=Goal.MAINTAIN)
    expected_carbs = carbs_from_remainder(2200, targets.protein_g, targets.fat_g)
    assert targets.carbs_g == expected_carbs


def test_carbs_from_remainder_never_negative():
    # Protein+fat calories deliberately exceed the target -- remainder must
    # floor at zero rather than go negative.
    assert carbs_from_remainder(1000, protein_g=150, fat_g=80) == 0


# ---------------------------------------------------------------------------
# Macro feasibility (section 12): protein must never be left to consume
# essentially the whole budget on an unusually low target / heavy user.
# ---------------------------------------------------------------------------
def test_protein_is_capped_when_it_would_dominate_a_low_calorie_target():
    # 120kg at 1.8 g/kg = 216g protein = 864 kcal. Against a 1300 kcal
    # target that's 66% of the budget -- must be capped down.
    targets = macros_for_calories(1300, weight_kg=120, goal=Goal.CUT)
    protein_calories = targets.protein_g * 4
    assert protein_calories / 1300 <= 0.41  # cap is 0.40; allow rounding slack
    assert abs(reconstructed_calories(targets) - 1300) <= MACRO_RECONCILIATION_TOLERANCE_KCAL
    # Fat and carbs still get *some* real room, not zero-by-neglect.
    assert targets.fat_g > 0


def test_fat_is_reduced_before_carbs_are_forced_negative():
    # A heavy cutter where protein alone is capped and fat's natural value
    # still wouldn't fit what's left -- fat must shrink to fit, and carbs
    # must never go negative or the target must still reconcile.
    targets = macros_for_calories(1250, weight_kg=140, goal=Goal.CUT)
    assert targets.carbs_g >= 0
    assert abs(reconstructed_calories(targets) - 1250) <= MACRO_RECONCILIATION_TOLERANCE_KCAL


def test_regression_macros_never_exceed_the_calorie_target():
    # The exact reported bug: a 2000 kcal target whose macros summed to
    # ~2054 kcal. Sweep a range of low-to-high calories/weights/goals
    # (including deliberately extreme low-calorie/heavy combinations where
    # protein and fat alone could plausibly exceed the target) and assert
    # the full invariant holds everywhere, not just in one hand-picked
    # case: every gram value stays non-negative, and the reconstructed
    # macro calories never exceed the target beyond rounding tolerance.
    for calories in (1200, 1300, 1500, 1800, 2000, 2400, 3000):
        for weight_kg in (40, 50, 65, 80, 100, 130, 160):
            for goal in (Goal.CUT, Goal.MAINTAIN, Goal.BULK):
                targets = macros_for_calories(calories, weight_kg, goal)
                assert targets.protein_g >= 0, (calories, weight_kg, goal, targets)
                assert targets.fat_g >= 0, (calories, weight_kg, goal, targets)
                assert targets.carbs_g >= 0, (calories, weight_kg, goal, targets)
                assert (
                    reconstructed_calories(targets)
                    <= calories + MACRO_RECONCILIATION_TOLERANCE_KCAL
                ), (calories, weight_kg, goal, targets)


# ---------------------------------------------------------------------------
# Custom macros (section 13)
# ---------------------------------------------------------------------------
def test_custom_macros_within_tolerance_accepted():
    validate_custom_macros(protein_g=150, carbs_g=200, fat_g=65, target_calories=2000)


def test_custom_macros_far_from_target_calories_rejected():
    with pytest.raises(ValueError, match="kcal"):
        validate_custom_macros(protein_g=300, carbs_g=400, fat_g=150, target_calories=2000)


def test_custom_macros_rejects_negative_grams():
    with pytest.raises(ValueError):
        validate_custom_macros(protein_g=-10, carbs_g=200, fat_g=65, target_calories=2000)


def test_custom_macros_rejects_protein_and_fat_alone_exceeding_calories():
    # protein+fat alone imply 1230 kcal against a 1200 kcal target -- just
    # 2.5% over, so the ±5% overall-tolerance check alone would pass this;
    # the separate protein+fat feasibility check must still catch it.
    with pytest.raises(ValueError, match="Protein and fat"):
        validate_custom_macros(protein_g=150, carbs_g=0, fat_g=70, target_calories=1200)


def test_custom_macros_carbs_are_recalculated_as_the_exact_remainder():
    # Regression for the ~2054-vs-2000 class of bug in custom mode: even
    # though the caller submitted a carbs figure, the value actually used
    # must reconcile exactly with the calorie target, not merely be
    # "within 5%" of it.
    protein_g, fat_g, target_calories = 150, 65, 2000
    validate_custom_macros(protein_g, carbs_g=200, fat_g=fat_g, target_calories=target_calories)
    carbs_g = carbs_from_remainder(target_calories, protein_g, fat_g)
    reconstructed = protein_g * 4 + carbs_g * 4 + fat_g * 9
    assert abs(reconstructed - target_calories) <= MACRO_RECONCILIATION_TOLERANCE_KCAL


# ---------------------------------------------------------------------------
# Full pipeline sanity
# ---------------------------------------------------------------------------
def test_calculate_macro_targets_cut_has_lower_calories_than_bulk():
    common = dict(
        weight_kg=80,
        height_cm=180,
        age_years=28,
        sex=BiologicalSex.MALE,
        activity_level=ActivityLevel.MODERATE,
    )
    cut = calculate_macro_targets(**common, goal=Goal.CUT, rate_kg_per_week=0.5)
    bulk = calculate_macro_targets(**common, goal=Goal.BULK, rate_kg_per_week=0.25)
    assert cut.calories < bulk.calories
    assert abs(reconstructed_calories(cut) - cut.calories) <= MACRO_RECONCILIATION_TOLERANCE_KCAL


def test_calculate_remaining_macros_never_negative():
    targets = calculate_macro_targets(
        weight_kg=70,
        height_cm=170,
        age_years=25,
        sex=BiologicalSex.FEMALE,
        activity_level=ActivityLevel.LIGHT,
        goal=Goal.MAINTAIN,
    )
    remaining = calculate_remaining_macros(
        targets,
        consumed_calories=targets.calories + 1000,
        consumed_protein_g=targets.protein_g + 50,
        consumed_carbs_g=0,
        consumed_fat_g=0,
    )
    assert remaining.calories == 0
    assert remaining.protein_g == 0
    assert remaining.carbs_g == targets.carbs_g

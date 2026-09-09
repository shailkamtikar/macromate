import pytest

from app.domain.macros import (
    ActivityLevel,
    BiologicalSex,
    Goal,
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
    macros_for_calories,
    safe_calorie_floor,
    suggested_water_goal_ml,
    validate_calorie_override,
    validate_custom_macros,
)


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


def test_calculate_macro_targets_cut_has_lower_calories_than_bulk():
    common = dict(
        weight_kg=80,
        height_cm=180,
        age_years=28,
        sex=BiologicalSex.MALE,
        activity_level=ActivityLevel.MODERATE,
    )
    cut = calculate_macro_targets(**common, goal=Goal.CUT)
    bulk = calculate_macro_targets(**common, goal=Goal.BULK)
    assert cut.calories < bulk.calories
    # Macro grams should roughly reconstruct total calories (protein/carbs 4
    # kcal/g, fat 9 kcal/g), within rounding tolerance.
    reconstructed = cut.protein_g * 4 + cut.carbs_g * 4 + cut.fat_g * 9
    assert reconstructed == pytest.approx(cut.calories, abs=5)


def test_suggested_water_goal_scales_with_weight_and_activity():
    sedentary = suggested_water_goal_ml(70, ActivityLevel.SEDENTARY)
    active = suggested_water_goal_ml(70, ActivityLevel.ACTIVE)
    assert sedentary == 2450  # 70 * 35
    assert active == 2950  # 70 * 35 + 500


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


# ---------------------------------------------------------------------------
# Activity level -> TDEE
# ---------------------------------------------------------------------------
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
    assert len(set(tdees)) == 5  # every level produces a genuinely different number


# ---------------------------------------------------------------------------
# Weight-loss / gain rate -> calorie adjustment
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("rate", [0.5, 0.75, 1.0])
def test_cut_rate_produces_proportionally_larger_deficit(rate):
    adjustment = calorie_adjustment_for_rate(Goal.CUT, rate)
    assert adjustment < 0
    assert adjustment == pytest.approx(-rate * 1100, abs=1)


def test_cut_rate_deficits_are_strictly_ordered():
    deficits = [calorie_adjustment_for_rate(Goal.CUT, r) for r in (0.5, 0.75, 1.0)]
    assert deficits[0] > deficits[1] > deficits[2]  # more aggressive rate -> larger deficit


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


def test_recommended_calories_for_maintain_equals_tdee():
    rec = calculate_recommended_calories(
        weight_kg=75,
        height_cm=178,
        age_years=28,
        sex=BiologicalSex.MALE,
        activity_level=ActivityLevel.MODERATE,
        goal=Goal.MAINTAIN,
        rate_kg_per_week=None,
    )
    assert rec.calories == rec.tdee


@pytest.mark.parametrize("rate", [0.5, 0.75, 1.0])
def test_recommended_calories_for_cut_reflects_selected_rate(rate):
    # High TDEE (heavy, very active) so even the most aggressive 1kg/week
    # deficit lands well clear of the safety floor — isolates the
    # rate-to-deficit math from the floor-clamping behavior tested
    # separately below.
    common = dict(
        weight_kg=95,
        height_cm=185,
        age_years=25,
        sex=BiologicalSex.MALE,
        activity_level=ActivityLevel.VERY_ACTIVE,
    )
    maintain = calculate_recommended_calories(**common, goal=Goal.MAINTAIN)
    cut = calculate_recommended_calories(**common, goal=Goal.CUT, rate_kg_per_week=rate)
    assert cut.calories < maintain.calories
    implied_deficit = maintain.calories - cut.calories
    assert implied_deficit == pytest.approx(rate * 1100, abs=2)


def test_recommended_calories_never_drops_below_safety_floor():
    # A very light, low-BMR profile at the most aggressive cut rate — the
    # naive TDEE-deficit math could go below the safety floor; it must be
    # clamped instead.
    rec = calculate_recommended_calories(
        weight_kg=45,
        height_cm=150,
        age_years=60,
        sex=BiologicalSex.FEMALE,
        activity_level=ActivityLevel.SEDENTARY,
        goal=Goal.CUT,
        rate_kg_per_week=1.0,
    )
    assert rec.calories >= safe_calorie_floor(rec.bmr)
    assert rec.calories >= MIN_SAFE_DAILY_CALORIES


# ---------------------------------------------------------------------------
# Calorie override
# ---------------------------------------------------------------------------
def test_calorie_override_within_tolerance_is_accepted():
    validate_calorie_override(calories=2100, recommended=2000, bmr=1500)  # no raise


def test_calorie_override_beyond_tolerance_is_rejected():
    with pytest.raises(ValueError):
        validate_calorie_override(calories=2700, recommended=2000, bmr=1500)


def test_calorie_override_below_safety_floor_is_rejected():
    with pytest.raises(ValueError):
        validate_calorie_override(calories=1100, recommended=1300, bmr=1000)


# ---------------------------------------------------------------------------
# Automatic vs custom macros
# ---------------------------------------------------------------------------
def test_macros_for_calories_reconstructs_target_calories():
    targets = macros_for_calories(2000, weight_kg=75, goal=Goal.MAINTAIN)
    reconstructed = targets.protein_g * 4 + targets.carbs_g * 4 + targets.fat_g * 9
    assert reconstructed == pytest.approx(2000, abs=5)


def test_custom_macros_within_tolerance_accepted():
    # 150p + 200c + 65f = 600+800+585 = 1985 kcal, target 2000 -> within 5%
    validate_custom_macros(protein_g=150, carbs_g=200, fat_g=65, target_calories=2000)  # no raise


def test_custom_macros_far_from_target_calories_rejected():
    with pytest.raises(ValueError, match="kcal"):
        validate_custom_macros(protein_g=300, carbs_g=400, fat_g=150, target_calories=2000)


def test_custom_macros_rejects_negative_grams():
    with pytest.raises(ValueError):
        validate_custom_macros(protein_g=-10, carbs_g=200, fat_g=65, target_calories=2000)

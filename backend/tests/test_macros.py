import pytest

from app.domain.macros import (
    ActivityLevel,
    BiologicalSex,
    Goal,
    calculate_bmi,
    calculate_bmr,
    calculate_macro_targets,
    calculate_remaining_macros,
    calculate_tdee,
    bmi_category,
    suggested_water_goal_ml,
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

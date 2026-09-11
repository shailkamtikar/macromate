import pytest

from app.domain.food import (
    compute_nutrition_snapshot,
    likely_duplicates,
    parse_serving_weight,
)


def test_compute_nutrition_snapshot_scales_by_quantity():
    snapshot = compute_nutrition_snapshot(
        calories_per_serving=200,
        protein_g_per_serving=20,
        carbs_g_per_serving=10,
        fat_g_per_serving=5,
        quantity=1.5,
    )
    assert snapshot.calories == 300
    assert snapshot.protein_g == 30
    assert snapshot.carbs_g == 15
    assert snapshot.fat_g == 7.5


def test_compute_nutrition_snapshot_rejects_non_positive_quantity():
    with pytest.raises(ValueError):
        compute_nutrition_snapshot(
            calories_per_serving=100,
            protein_g_per_serving=1,
            carbs_g_per_serving=1,
            fat_g_per_serving=1,
            quantity=0,
        )


def test_likely_duplicates_filters_by_threshold():
    candidates = [
        {"name": "Banana", "similarity": 0.9},
        {"name": "Banana Bread", "similarity": 0.3},
        {"name": "Unrelated", "similarity": 0.05},
    ]
    result = likely_duplicates(candidates, threshold=0.4)
    assert [c["name"] for c in result] == ["Banana"]


# ---------------------------------------------------------------------------
# Serving-weight parsing — the basis for offering gram/ml entry alongside
# serving entry in the diary, derived from real serving descriptions rather
# than an invented gram equivalent.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "description,amount,unit",
    [
        ("100g", 100.0, "g"),
        ("100 g", 100.0, "g"),
        ("1 bowl (150 g)", 150.0, "g"),
        ("30g serving", 30.0, "g"),
        ("250ml", 250.0, "ml"),
        ("1 cup (240 ml)", 240.0, "ml"),
        ("12.5 g", 12.5, "g"),
    ],
)
def test_parse_serving_weight_reads_explicit_weights(description, amount, unit):
    weight = parse_serving_weight(description)
    assert weight is not None
    assert weight.amount == pytest.approx(amount)
    assert weight.unit == unit


@pytest.mark.parametrize(
    "description",
    ["2 slices", "1 bowl", "", None, "1 medium banana", "0 g"],
)
def test_parse_serving_weight_returns_none_without_an_explicit_weight(description):
    # No stated weight means the app offers servings only — it must not
    # invent a gram equivalent it has no basis for.
    assert parse_serving_weight(description) is None


def test_parse_serving_weight_does_not_match_a_bare_count():
    # "2 slices" has a number but no unit; "5 grams" does. The distinction
    # is what keeps count-based foods from getting a bogus gram unit.
    assert parse_serving_weight("2 slices") is None
    assert parse_serving_weight("5 grams") is not None

import pytest

from app.domain.food import compute_nutrition_snapshot, likely_duplicates


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

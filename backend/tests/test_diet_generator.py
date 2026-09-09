import pytest

from app.domain.diet_generator import parse_and_validate_plan
from app.domain.macros import MacroTargets


def _targets():
    return MacroTargets(calories=2000, protein_g=150, carbs_g=200, fat_g=65)


def test_parses_valid_plan_within_tolerance():
    raw = """{"meals": [
        {"meal_type": "breakfast", "description": "Oats and eggs", "calories": 500, "protein_g": 35, "carbs_g": 50, "fat_g": 15},
        {"meal_type": "lunch", "description": "Chicken rice bowl", "calories": 700, "protein_g": 55, "carbs_g": 70, "fat_g": 20},
        {"meal_type": "dinner", "description": "Salmon and veggies", "calories": 800, "protein_g": 60, "carbs_g": 80, "fat_g": 30}
    ], "notes": "Great balance of macros today!"}"""
    result = parse_and_validate_plan(raw, _targets())
    assert len(result.plan.meals) == 3
    assert result.total_calories == 2000
    assert result.within_tolerance is True


def test_flags_plan_far_outside_tolerance():
    raw = """{"meals": [
        {"meal_type": "breakfast", "description": "Huge feast", "calories": 5000, "protein_g": 35, "carbs_g": 50, "fat_g": 15}
    ], "notes": "Enjoy!"}"""
    result = parse_and_validate_plan(raw, _targets())
    assert result.within_tolerance is False


def test_strips_markdown_fence():
    raw = '```json\n{"meals": [{"meal_type": "breakfast", "description": "x", "calories": 500, "protein_g": 30, "carbs_g": 50, "fat_g": 15}], "notes": "ok"}\n```'
    result = parse_and_validate_plan(raw, _targets())
    assert len(result.plan.meals) == 1


def test_rejects_empty_meals():
    with pytest.raises(ValueError):
        parse_and_validate_plan('{"meals": [], "notes": "x"}', _targets())


def test_rejects_malformed_json():
    with pytest.raises(ValueError):
        parse_and_validate_plan("not json", _targets())

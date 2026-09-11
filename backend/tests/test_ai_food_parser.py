import pytest

from app.domain.ai_food_parser import parse_gemini_food_list

_ESTIMATE_FIELDS = '"estimated_calories": 100, "estimated_protein_g": 5, "estimated_carbs_g": 10, "estimated_fat_g": 4'


def test_parses_plain_json_array():
    raw = (
        '[{"raw_phrase": "1 roti", "search_name": "roti", "amount": 1.0, "unit": "serving", '
        f"{_ESTIMATE_FIELDS}}}]"
    )
    items = parse_gemini_food_list(raw)
    assert len(items) == 1
    assert items[0].search_name == "roti"
    assert items[0].amount == 1.0
    assert items[0].unit == "serving"
    assert items[0].estimated_calories == 100


def test_strips_markdown_code_fence():
    raw = (
        '```json\n[{"raw_phrase": "1 roti", "search_name": "roti", "amount": 1.0, '
        f'"unit": "serving", {_ESTIMATE_FIELDS}}}]\n```'
    )
    items = parse_gemini_food_list(raw)
    assert len(items) == 1


def test_empty_array_for_no_food():
    assert parse_gemini_food_list("[]") == []


def test_rejects_non_array():
    with pytest.raises(ValueError):
        parse_gemini_food_list('{"raw_phrase": "x"}')


def test_rejects_malformed_json():
    with pytest.raises(ValueError):
        parse_gemini_food_list("not json at all")


def test_rejects_missing_fields():
    with pytest.raises(ValueError):
        parse_gemini_food_list('[{"raw_phrase": "1 roti"}]')


def test_rejects_non_positive_amount():
    raw = (
        '[{"raw_phrase": "x", "search_name": "x", "amount": 0, "unit": "serving", '
        f"{_ESTIMATE_FIELDS}}}]"
    )
    with pytest.raises(ValueError):
        parse_gemini_food_list(raw)


def test_estimate_fields_are_captured():
    raw = (
        '[{"raw_phrase": "200g paneer", "search_name": "paneer", "amount": 200, "unit": "g", '
        '"estimated_calories": 550, "estimated_protein_g": 36, "estimated_carbs_g": 8, '
        '"estimated_fat_g": 42, "assumption": "Values vary by brand."}]'
    )
    items = parse_gemini_food_list(raw)
    item = items[0]
    assert item.estimated_calories == 550
    assert item.estimated_protein_g == 36
    assert item.estimated_carbs_g == 8
    assert item.estimated_fat_g == 42
    assert item.assumption == "Values vary by brand."


def test_estimate_fields_default_assumption_to_empty_string():
    raw = (
        '[{"raw_phrase": "x", "search_name": "x", "amount": 1, "unit": "serving", '
        f"{_ESTIMATE_FIELDS}}}]"
    )
    items = parse_gemini_food_list(raw)
    assert items[0].assumption == ""


def test_rejects_negative_estimate():
    raw = (
        '[{"raw_phrase": "x", "search_name": "x", "amount": 1, "unit": "serving", '
        '"estimated_calories": -5, "estimated_protein_g": 5, "estimated_carbs_g": 10, '
        '"estimated_fat_g": 4}]'
    )
    with pytest.raises(ValueError):
        parse_gemini_food_list(raw)


@pytest.mark.parametrize(
    "raw_unit,expected",
    [
        ("g", "g"),
        ("grams", "g"),
        ("Gram", "g"),
        ("GM", "g"),
        ("ml", "ml"),
        ("Milliliters", "ml"),
        ("serving", "serving"),
        ("servings", "serving"),
        ("cup", "serving"),
        ("bowl", "serving"),
        ("", "serving"),
    ],
)
def test_normalizes_unit_spellings_and_defaults_unknowns_to_serving(raw_unit, expected):
    raw = (
        f'[{{"raw_phrase": "x", "search_name": "x", "amount": 1, "unit": "{raw_unit}", '
        f"{_ESTIMATE_FIELDS}}}]"
    )
    items = parse_gemini_food_list(raw)
    assert items[0].unit == expected


def test_amount_g_and_ml_are_kept_distinct_from_serving():
    raw = (
        '[{"raw_phrase": "200g paneer", "search_name": "paneer", "amount": 200, "unit": "g", '
        f'{_ESTIMATE_FIELDS}}}, '
        '{"raw_phrase": "250ml milk", "search_name": "milk", "amount": 250, "unit": "ml", '
        f"{_ESTIMATE_FIELDS}}}]"
    )
    items = parse_gemini_food_list(raw)
    assert items[0].amount == 200
    assert items[0].unit == "g"
    assert items[1].amount == 250
    assert items[1].unit == "ml"

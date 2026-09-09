import pytest

from app.domain.ai_food_parser import parse_gemini_food_list


def test_parses_plain_json_array():
    raw = '[{"raw_phrase": "1 roti", "search_name": "roti", "quantity_multiplier": 1.0}]'
    items = parse_gemini_food_list(raw)
    assert len(items) == 1
    assert items[0].search_name == "roti"
    assert items[0].quantity_multiplier == 1.0


def test_strips_markdown_code_fence():
    raw = '```json\n[{"raw_phrase": "1 roti", "search_name": "roti", "quantity_multiplier": 1.0}]\n```'
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


def test_rejects_non_positive_quantity():
    raw = '[{"raw_phrase": "x", "search_name": "x", "quantity_multiplier": 0}]'
    with pytest.raises(ValueError):
        parse_gemini_food_list(raw)

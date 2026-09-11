import pytest

from app.domain.coach_intent import parse_coach_intent


def test_parses_a_read_intent():
    raw = '{"in_scope": true, "intent": "read", "reply": "Your BMI is 22.1."}'
    intent = parse_coach_intent(raw)
    assert intent.in_scope is True
    assert intent.intent == "read"
    assert intent.reply == "Your BMI is 22.1."
    assert intent.foods == []


def test_out_of_scope_flag_is_captured():
    raw = '{"in_scope": false, "intent": "read", "reply": "irrelevant"}'
    intent = parse_coach_intent(raw)
    assert intent.in_scope is False


def test_parses_add_food_intent_with_nested_food_items():
    raw = """
    {
      "in_scope": true,
      "intent": "add_food",
      "foods": [
        {"raw_phrase": "200g paneer", "search_name": "paneer", "amount": 200, "unit": "g",
         "estimated_calories": 550, "estimated_protein_g": 36, "estimated_carbs_g": 8,
         "estimated_fat_g": 42, "assumption": ""}
      ],
      "meal_type": "lunch",
      "reply": ""
    }
    """
    intent = parse_coach_intent(raw)
    assert intent.intent == "add_food"
    assert intent.meal_type == "lunch"
    assert len(intent.foods) == 1
    assert intent.foods[0].search_name == "paneer"
    assert intent.foods[0].amount == 200


def test_parses_log_water_intent():
    raw = '{"in_scope": true, "intent": "log_water", "water_ml": 2000, "reply": ""}'
    intent = parse_coach_intent(raw)
    assert intent.intent == "log_water"
    assert intent.water_ml == 2000


def test_parses_remove_food_intent():
    raw = '{"in_scope": true, "intent": "remove_food", "remove_description": "the paneer", "reply": ""}'
    intent = parse_coach_intent(raw)
    assert intent.intent == "remove_food"
    assert intent.remove_description == "the paneer"


def test_parses_needs_clarification():
    raw = (
        '{"in_scope": true, "intent": "add_food", "needs_clarification": true, '
        '"clarification_question": "How much chicken?", "reply": ""}'
    )
    intent = parse_coach_intent(raw)
    assert intent.needs_clarification is True
    assert intent.clarification_question == "How much chicken?"


def test_parses_nutrition_estimate_array():
    raw = """
    {
      "in_scope": true,
      "intent": "read",
      "nutrition_estimate": [
        {"food_name": "Paneer", "amount": 200, "unit": "g", "calories": 550,
         "protein_g": 36, "carbs_g": 8, "fat_g": 42, "assumption": "Varies by brand."}
      ],
      "reply": "About 550 kcal for 200g paneer."
    }
    """
    intent = parse_coach_intent(raw)
    assert len(intent.nutrition_estimate) == 1
    assert intent.nutrition_estimate[0].calories == 550


def test_defaults_intent_to_read_when_omitted():
    raw = '{"in_scope": true, "reply": "Hi there."}'
    intent = parse_coach_intent(raw)
    assert intent.intent == "read"


def test_strips_markdown_code_fence():
    raw = '```json\n{"in_scope": true, "intent": "read", "reply": "ok"}\n```'
    intent = parse_coach_intent(raw)
    assert intent.reply == "ok"


def test_rejects_malformed_json():
    with pytest.raises(ValueError):
        parse_coach_intent("not json at all")


def test_rejects_non_object():
    with pytest.raises(ValueError):
        parse_coach_intent("[1, 2, 3]")


def test_rejects_invalid_intent_value():
    raw = '{"in_scope": true, "intent": "delete_everything", "reply": ""}'
    with pytest.raises(ValueError):
        parse_coach_intent(raw)


def test_missing_in_scope_is_rejected():
    with pytest.raises(ValueError):
        parse_coach_intent('{"intent": "read", "reply": "ok"}')

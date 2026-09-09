from app.domain.coach import build_context, deterministic_fast_path
from app.domain.macros import BiologicalSex, Goal, MacroTargets


def _ctx():
    target = MacroTargets(calories=2200, protein_g=160, carbs_g=220, fat_g=70)
    return build_context(
        weight_kg=75,
        height_cm=178,
        sex=BiologicalSex.MALE,
        goal=Goal.MAINTAIN,
        target=target,
        consumed_calories=1800,
        consumed_protein_g=130,
        consumed_carbs_g=180,
        consumed_fat_g=50,
        recent_weights_kg=[76, 75.5, 75],
    )


def test_protein_left_fast_path():
    ctx = _ctx()
    answer = deterministic_fast_path("How much protein do I have left?", ctx)
    assert answer is not None
    assert "30g" in answer  # 160 - 130


def test_bmi_fast_path():
    ctx = _ctx()
    answer = deterministic_fast_path("What's my BMI?", ctx)
    assert answer is not None
    assert str(ctx.bmi) in answer


def test_maintenance_calories_fast_path():
    ctx = _ctx()
    answer = deterministic_fast_path("What should my maintenance calories be?", ctx)
    assert answer is not None
    assert "2200" in answer


def test_calories_left_fast_path():
    ctx = _ctx()
    answer = deterministic_fast_path("How many calories do I have left today?", ctx)
    assert answer is not None
    assert "400" in answer  # 2200 - 1800


def test_open_ended_question_has_no_fast_path():
    ctx = _ctx()
    assert deterministic_fast_path("What should I eat for dinner tonight?", ctx) is None

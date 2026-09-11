"""Pure unit tests for the deterministic "What to Eat Next" ranking logic
(app/domain/suggestions.py) -- no database involved. These prove the
recommendation *model* is right (calories are a ranking signal, not an
exact-fit gate; protein ranks appropriately when it's the real gap;
personalization/verified are small tiebreakers) independent of how the
candidate pool was fetched."""

from app.domain.suggestions import (
    REASONABLE_CALORIE_FLOOR,
    REASONABLE_CALORIE_MULTIPLIER,
    SuggestionCandidate,
    is_reasonable_for_remaining,
    rank_candidates,
)


def _food(id_, calories, protein_g, *, verified=False, personal=False, carbs_g=0, fat_g=0):
    return SuggestionCandidate(
        id=id_,
        name=id_,
        brand=None,
        serving_description="1 serving",
        calories=calories,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g,
        verified=verified,
        is_personal_history=personal,
    )


def test_a_food_does_not_need_to_consume_the_entire_remaining_budget_to_be_ranked():
    # 200 kcal food against a 2080 kcal remaining budget used to be
    # perfectly fine under the old exact-fit filter too, but a food that
    # uses only a small fraction of a *large* remaining budget must still
    # be rankable, not just merely "not excluded".
    chicken = _food("chicken", calories=250, protein_g=47, verified=True)
    ranked = rank_candidates([chicken], remaining_calories=2080, remaining_protein_g=182, protein_is_priority=True)
    assert ranked == [chicken]


def test_large_remaining_gap_still_produces_suggestions_from_eligible_foods():
    foods = [
        _food("dal", calories=200, protein_g=12, verified=True),
        _food("roti", calories=105, protein_g=3, verified=True),
        _food("egg_bhurji", calories=450, protein_g=20, personal=True),
    ]
    ranked = rank_candidates(
        foods, remaining_calories=2080, remaining_protein_g=182, protein_is_priority=True
    )
    assert len(ranked) == 3
    assert {c.id for c in ranked} == {"dal", "roti", "egg_bhurji"}


def test_protein_rich_food_ranks_above_low_protein_food_when_protein_is_the_priority():
    lean = _food("lean", calories=150, protein_g=30)
    carby = _food("carby", calories=150, protein_g=2)
    ranked = rank_candidates(
        [carby, lean], remaining_calories=2200, remaining_protein_g=160, protein_is_priority=True
    )
    assert ranked[0].id == "lean"


def test_protein_no_longer_drives_ranking_once_the_target_is_already_met():
    # Same two foods, but protein_is_priority=False (target already hit) --
    # a bigger, better calorie-budget-fit food should not be out-ranked by
    # a tiny protein-dense one just because of its protein density.
    lean = _food("lean", calories=100, protein_g=25)
    better_fit = _food("better_fit", calories=700, protein_g=3)  # ~35% of 2000 remaining
    ranked = rank_candidates(
        [lean, better_fit],
        remaining_calories=2000,
        remaining_protein_g=0,
        protein_is_priority=False,
    )
    assert ranked[0].id == "better_fit"


def test_a_genuinely_unreasonable_feast_is_excluded_not_merely_deprioritized():
    reasonable = _food("normal_meal", calories=500, protein_g=30)
    feast = _food("feast", calories=5000, protein_g=50)
    ranked = rank_candidates(
        [reasonable, feast], remaining_calories=2200, remaining_protein_g=160, protein_is_priority=True
    )
    assert feast.id not in {c.id for c in ranked}
    assert reasonable.id in {c.id for c in ranked}


def test_is_reasonable_for_remaining_uses_a_multiplier_not_an_exact_fit():
    # Over the remaining budget, but not absurdly so -- must still be
    # reasonable (this is the exact regression the "2080 kcal / nothing
    # fits" bug represents: a real food modestly larger than what's left
    # must not be excluded).
    assert is_reasonable_for_remaining(calories=450, remaining_calories=300) is True
    # Wildly over budget -- genuinely unreasonable.
    assert is_reasonable_for_remaining(calories=5000, remaining_calories=300) is False
    # A small remaining budget still allows an ordinary small meal thanks
    # to the floor, not just whatever's smaller than the remaining number.
    assert is_reasonable_for_remaining(calories=350, remaining_calories=50) is True
    assert REASONABLE_CALORIE_MULTIPLIER > 1
    assert REASONABLE_CALORIE_FLOOR > 0


def test_zero_or_negative_calories_are_never_reasonable():
    assert is_reasonable_for_remaining(calories=0, remaining_calories=2000) is False
    assert is_reasonable_for_remaining(calories=-5, remaining_calories=2000) is False


def test_personal_history_and_verified_are_tiebreakers_not_the_main_driver():
    # Same nutrition, only the source/verification differs -- the
    # personal-history/verified foods should edge out an otherwise
    # identical unverified, non-personal candidate, but ranking must still
    # be driven primarily by protein/calorie fit elsewhere (see the
    # protein-priority test above).
    plain = _food("plain", calories=300, protein_g=20)
    personal = _food("personal", calories=300, protein_g=20, personal=True)
    verified = _food("verified", calories=300, protein_g=20, verified=True)
    ranked = rank_candidates(
        [plain, personal, verified],
        remaining_calories=2000,
        remaining_protein_g=150,
        protein_is_priority=True,
        limit=3,
    )
    assert ranked[0].id == "personal"
    assert ranked[1].id == "verified"
    assert ranked[2].id == "plain"


def test_ranking_is_deterministic_regardless_of_input_order():
    a = _food("a", calories=300, protein_g=20)
    b = _food("b", calories=300, protein_g=20)
    ranked_1 = rank_candidates([a, b], remaining_calories=2000, remaining_protein_g=150, protein_is_priority=True)
    ranked_2 = rank_candidates([b, a], remaining_calories=2000, remaining_protein_g=150, protein_is_priority=True)
    assert [c.id for c in ranked_1] == [c.id for c in ranked_2]


def test_respects_the_limit():
    foods = [_food(f"f{i}", calories=200 + i * 10, protein_g=10 + i) for i in range(10)]
    ranked = rank_candidates(
        foods, remaining_calories=2000, remaining_protein_g=150, protein_is_priority=True, limit=3
    )
    assert len(ranked) == 3

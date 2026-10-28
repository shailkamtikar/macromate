"""Suggestions cache: served per user, bypasses the database on a hit, and is
dropped when the user's food logs change. The database layer is faked."""

import pytest

from app.core import cache
from app.core.auth import CurrentUser
from app.routers import suggestions


@pytest.fixture(autouse=True)
def enable_cache(monkeypatch):
    monkeypatch.setattr(cache.get_settings(), "cache_enabled", True)
    cache._caches.clear()
    yield
    cache._caches.clear()


def test_second_call_is_served_from_cache_and_invalidation_clears_it(monkeypatch):
    calls = []

    def fake_build(user_id):
        calls.append(user_id)
        return suggestions.SuggestionsResponse(
            message=f"call {len(calls)}",
            remaining_calories=1,
            remaining_protein_g=1,
            remaining_carbs_g=1,
            remaining_fat_g=1,
            protein_is_priority=False,
            suggestions=[],
        )

    monkeypatch.setattr(suggestions, "_build_suggestions", fake_build)
    user = CurrentUser("user-1", None, {})

    first = suggestions.get_suggestions(user)
    second = suggestions.get_suggestions(user)
    assert first.message == second.message == "call 1"
    assert calls == ["user-1"]

    cache.invalidate_user("user-1", suggestions.SUGGESTIONS_CACHE_NS)
    assert suggestions.get_suggestions(user).message == "call 2"


def test_cache_never_crosses_users(monkeypatch):
    monkeypatch.setattr(
        suggestions,
        "_build_suggestions",
        lambda user_id: suggestions.SuggestionsResponse(
            message=user_id,
            remaining_calories=0,
            remaining_protein_g=0,
            remaining_carbs_g=0,
            remaining_fat_g=0,
            protein_is_priority=False,
            suggestions=[],
        ),
    )
    assert suggestions.get_suggestions(CurrentUser("a", None, {})).message == "a"
    assert suggestions.get_suggestions(CurrentUser("b", None, {})).message == "b"

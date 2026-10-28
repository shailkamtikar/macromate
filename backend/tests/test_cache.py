import pytest

from app.core import cache
from app.core.cache import get_cached, invalidate_user, set_cached


@pytest.fixture(autouse=True)
def enable_cache(monkeypatch):
    monkeypatch.setattr(cache.get_settings(), "cache_enabled", True)
    cache._caches.clear()
    yield
    cache._caches.clear()


def test_cache_is_per_user():
    set_cached("t-ns", "user-a", {"v": 1})
    assert get_cached("t-ns", "user-a") == {"v": 1}
    assert get_cached("t-ns", "user-b") is None


def test_invalidate_one_namespace_only():
    set_cached("t-ns1", "u", 1)
    set_cached("t-ns2", "u", 2)
    invalidate_user("u", "t-ns1")
    assert get_cached("t-ns1", "u") is None
    assert get_cached("t-ns2", "u") == 2


def test_invalidate_all_namespaces():
    set_cached("t-ns1", "u2", 1)
    set_cached("t-ns2", "u2", 2)
    invalidate_user("u2")
    assert get_cached("t-ns1", "u2") is None and get_cached("t-ns2", "u2") is None


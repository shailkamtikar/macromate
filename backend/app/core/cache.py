"""Tiny in-process, per-user TTL cache for expensive read endpoints.

Entries are keyed by (namespace, user_id), so one user's cached response can
never be served to another. Each Render instance keeps its own cache, which
is fine: the TTL is short and every write path that changes the underlying
data calls `invalidate_user`. Not a substitute for a shared cache if the
backend is ever scaled to several instances (a stale read is then bounded by
the TTL).
"""

import threading

from cachetools import TTLCache

from app.core.config import get_settings

_lock = threading.RLock()
_caches: dict[str, TTLCache] = {}


def _cache(namespace: str, ttl: float) -> TTLCache:
    with _lock:
        cache = _caches.get(namespace)
        if cache is None:
            cache = TTLCache(maxsize=2000, ttl=ttl)
            _caches[namespace] = cache
        return cache


def get_cached(namespace: str, user_id: str, ttl: float = 45):
    if not get_settings().cache_enabled:
        return None
    with _lock:
        return _cache(namespace, ttl).get(user_id)


def set_cached(namespace: str, user_id: str, value, ttl: float = 45) -> None:
    with _lock:
        _cache(namespace, ttl)[user_id] = value


def invalidate_user(user_id: str, namespace: str | None = None) -> None:
    """Drop a user's cached entries (all namespaces unless one is given).
    Call after any write that changes what a cached read would return."""
    with _lock:
        for name, cache in _caches.items():
            if namespace is None or name == namespace:
                cache.pop(user_id, None)

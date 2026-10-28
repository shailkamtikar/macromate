"""Marks every test module that talks to real Supabase or Gemini as `live`.

`uv run pytest -m "not live"` runs only the pure/deterministic tests (used by
CI); `uv run pytest -m live` runs the rest against whatever Supabase project
`backend/.env` points at -- which must be the TEST project, never production.
"""

import os
from pathlib import Path

import pytest

# Live tests write rows straight to the database (bypassing the API's cache
# invalidation), so the read cache is off for the whole suite. Its behaviour
# is covered by tests/test_cache.py and tests/test_suggestions_cache.py,
# which enable it explicitly.
os.environ.setdefault("CACHE_ENABLED", "false")
os.environ.setdefault("RECORD_AI_USAGE", "false")
os.environ.setdefault("AI_CALLS_PER_MINUTE", "1000")
os.environ.setdefault("AI_CALLS_PER_DAY", "100000")

_LIVE_MARKERS = (
    "supabase_service_role_key",
    "SupabaseAdmin",
    "supabase_url",
    "gemini_api_key",
    "GEMINI",
)


def pytest_collection_modifyitems(items):
    cache: dict[Path, bool] = {}
    for item in items:
        path = Path(str(item.fspath))
        if path not in cache:
            text = path.read_text(encoding="utf-8")
            # A module can opt out with a "# live-marker: off" comment when it
            # only mentions these names to fake them (no network involved).
            cache[path] = "# live-marker: off" not in text and any(
                marker in text for marker in _LIVE_MARKERS
            )
        if cache[path]:
            item.add_marker(pytest.mark.live)

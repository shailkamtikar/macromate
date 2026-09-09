"""Tests the Gemini wrapper against the real API — no mocked HTTP. The
fallback test uses a genuinely invalid primary model name so the API
itself returns a real error, proving the fallback path actually executes
rather than asserting mocked behavior."""

import pytest

from app.core.config import get_settings
from app.core.gemini import GeminiUnavailable, _call_model, generate_text

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.gemini_api_key, reason="GEMINI_API_KEY not configured"
)


def test_generate_text_returns_real_response():
    result = generate_text("Reply with exactly the word: PONG")
    assert "PONG" in result.upper()


def test_call_model_raises_on_invalid_model_name():
    from app.core.gemini import GeminiError

    with pytest.raises(GeminiError):
        _call_model(
            "not-a-real-gemini-model", "hello", system_instruction=None, timeout=10
        )


def test_generate_text_falls_back_and_still_succeeds(monkeypatch):
    # Force the primary model name to be invalid so the real API rejects
    # it, then verify the fallback model (still real, still configured)
    # picks up the request and succeeds.
    original_primary = settings.gemini_primary_model
    monkeypatch.setattr(settings, "gemini_primary_model", "not-a-real-gemini-model")
    try:
        result = generate_text("Reply with exactly the word: PONG")
        assert "PONG" in result.upper()
    finally:
        monkeypatch.setattr(settings, "gemini_primary_model", original_primary)


def test_generate_text_raises_when_both_models_invalid(monkeypatch):
    monkeypatch.setattr(settings, "gemini_primary_model", "not-a-real-model-1")
    monkeypatch.setattr(settings, "gemini_fallback_model", "not-a-real-model-2")
    with pytest.raises(GeminiUnavailable):
        generate_text("hello")

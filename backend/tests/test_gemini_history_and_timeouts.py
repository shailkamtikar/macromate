"""Unit tests for app/core/gemini.py's conversation-history wiring and
primary/fallback timeout behavior. Unlike test_gemini.py, these mock
`_call_model` directly and never make a real network call, so they run
regardless of whether GEMINI_API_KEY is configured."""

import pytest

from app.core.gemini import (
    DEFAULT_FALLBACK_TIMEOUT,
    GeminiError,
    GeminiUnavailable,
    _build_contents,
    generate_text,
)


def test_build_contents_maps_assistant_role_to_model_and_appends_the_new_prompt():
    history = [
        {"role": "user", "content": "How much protein do I have left?"},
        {"role": "assistant", "content": "You have 30g left."},
    ]
    contents = _build_contents("What about carbs?", history)
    assert contents == [
        {"role": "user", "parts": [{"text": "How much protein do I have left?"}]},
        {"role": "model", "parts": [{"text": "You have 30g left."}]},
        {"role": "user", "parts": [{"text": "What about carbs?"}]},
    ]


def test_build_contents_with_no_history_is_just_the_prompt():
    assert _build_contents("hello", None) == [{"role": "user", "parts": [{"text": "hello"}]}]
    assert _build_contents("hello", []) == [{"role": "user", "parts": [{"text": "hello"}]}]


def test_generate_text_forwards_history_and_prompt_to_the_model_call(monkeypatch):
    captured = {}

    def fake_call_model(model, prompt, *, system_instruction, timeout, history=None):
        captured["model"] = model
        captured["prompt"] = prompt
        captured["history"] = history
        return "ok"

    monkeypatch.setattr("app.core.gemini._call_model", fake_call_model)
    history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]

    result = generate_text("next message", history=history)

    assert result == "ok"
    assert captured["prompt"] == "next message"
    assert captured["history"] == history


def test_generate_text_uses_a_shorter_fallback_timeout_by_default(monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    calls = []

    def fake_call_model(model, prompt, *, system_instruction, timeout, history=None):
        calls.append((model, timeout))
        if model == settings.gemini_primary_model:
            raise GeminiError("primary down")
        return "fallback ok"

    monkeypatch.setattr("app.core.gemini._call_model", fake_call_model)

    result = generate_text("hi", timeout=20.0)

    assert result == "fallback ok"
    assert len(calls) == 2
    primary_model, primary_timeout = calls[0]
    fallback_model, fallback_timeout = calls[1]
    assert primary_model == settings.gemini_primary_model
    assert primary_timeout == 20.0
    assert fallback_model == settings.gemini_fallback_model
    # The whole point of the fix: a hung primary must not double the
    # worst-case wait by giving the fallback the same generous timeout.
    assert fallback_timeout == DEFAULT_FALLBACK_TIMEOUT
    assert fallback_timeout < primary_timeout


def test_generate_text_respects_an_explicit_fallback_timeout(monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    calls = []

    def fake_call_model(model, prompt, *, system_instruction, timeout, history=None):
        calls.append((model, timeout))
        if model == settings.gemini_primary_model:
            raise GeminiError("primary down")
        return "fallback ok"

    monkeypatch.setattr("app.core.gemini._call_model", fake_call_model)

    generate_text("hi", timeout=20.0, fallback_timeout=3.0)

    assert calls[1][1] == 3.0


def test_generate_text_never_lets_fallback_timeout_exceed_primary(monkeypatch):
    """A caller passing a primary timeout shorter than the default fallback
    timeout must not end up with a *longer* fallback wait than primary."""
    from app.core.config import get_settings

    settings = get_settings()
    calls = []

    def fake_call_model(model, prompt, *, system_instruction, timeout, history=None):
        calls.append((model, timeout))
        if model == settings.gemini_primary_model:
            raise GeminiError("primary down")
        return "fallback ok"

    monkeypatch.setattr("app.core.gemini._call_model", fake_call_model)

    generate_text("hi", timeout=2.0)

    assert calls[1][1] <= 2.0


def test_generate_text_raises_when_both_calls_fail(monkeypatch):
    def fake_call_model(model, prompt, *, system_instruction, timeout, history=None):
        raise GeminiError(f"{model} down")

    monkeypatch.setattr("app.core.gemini._call_model", fake_call_model)

    with pytest.raises(GeminiUnavailable):
        generate_text("hi")

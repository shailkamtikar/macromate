"""The Gemini wrapper must cap concurrent calls and fail fast when full, so
slow AI requests can never starve ordinary data endpoints. Pure unit tests:
the model call itself is monkeypatched, nothing touches the network."""

import threading
import time

import pytest

from app.core import gemini


def test_busy_wrapper_fails_fast_instead_of_queueing(monkeypatch):
    # Occupy every slot, then a new call must fail quickly with the same
    # exception type callers already handle (-> HTTP 503).
    monkeypatch.setattr(gemini, "_SLOT_WAIT_SECONDS", 0.05)
    held = []
    while gemini._ai_slots.acquire(blocking=False):
        held.append(1)
    try:
        started = time.monotonic()
        with pytest.raises(gemini.GeminiUnavailable):
            gemini.generate_text("hello")
        assert time.monotonic() - started < 1.0
    finally:
        for _ in held:
            gemini._ai_slots.release()


def test_slot_is_released_after_success_and_failure(monkeypatch):
    calls = []

    def fake_call(model, prompt, **kwargs):
        calls.append(model)
        if model == gemini.get_settings().gemini_primary_model:
            raise gemini.GeminiError("primary down")
        return "ok"

    monkeypatch.setattr(gemini, "_call_model", fake_call)
    available_before = gemini._ai_slots._value
    assert gemini.generate_text("hi") == "ok"  # primary fails, fallback answers
    assert gemini._ai_slots._value == available_before

    def always_fail(model, prompt, **kwargs):
        raise gemini.GeminiError("down")

    monkeypatch.setattr(gemini, "_call_model", always_fail)
    with pytest.raises(gemini.GeminiUnavailable):
        gemini.generate_text("hi")
    assert gemini._ai_slots._value == available_before


def test_concurrency_never_exceeds_limit(monkeypatch):
    limit = gemini.get_settings().ai_max_concurrency
    running = 0
    peak = 0
    lock = threading.Lock()

    def slow_call(model, prompt, **kwargs):
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        time.sleep(0.1)
        with lock:
            running -= 1
        return "ok"

    monkeypatch.setattr(gemini, "_call_model", slow_call)
    monkeypatch.setattr(gemini, "_SLOT_WAIT_SECONDS", 5.0)
    threads = [threading.Thread(target=gemini.generate_text, args=("x",)) for _ in range(limit * 3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak <= limit

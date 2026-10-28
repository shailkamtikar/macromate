# live-marker: off
"""Quota limits, safe Gemini errors, header auth, native JSON mode, thinking
fallback and safety-block handling. All offline: HTTP is faked."""

import pytest
from fastapi.testclient import TestClient

from app.core import gemini, quota
from app.core.auth import CurrentUser, get_current_user
from app.core.config import get_settings
from app.main import app


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or str(self._payload)

    def json(self):
        return self._payload


def ok(text="hello"):
    return FakeResponse(
        200,
        {
            "candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 3},
        },
    )


@pytest.fixture(autouse=True)
def fresh_quota():
    quota.reset_for_tests()
    yield
    quota.reset_for_tests()


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "gemini_api_key", "test-key-not-real")
    monkeypatch.setattr(quota, "_hydrate_day_count", lambda user_id, day: 0)
    return settings


# ----------------------------------------------------------------- quota
def test_per_minute_limit_then_recovers(monkeypatch, configured):
    monkeypatch.setattr(configured, "ai_calls_per_minute", 3)
    for i in range(3):
        quota.check_and_reserve("u1", now=100.0 + i)
    with pytest.raises(quota.QuotaExceeded) as exc:
        quota.check_and_reserve("u1", now=103.0)
    assert exc.value.retry_after_seconds >= 1
    # A minute after the first call the window has room again.
    quota.check_and_reserve("u1", now=161.0)


def test_limits_are_per_user(monkeypatch, configured):
    monkeypatch.setattr(configured, "ai_calls_per_minute", 1)
    quota.check_and_reserve("a", now=1.0)
    quota.check_and_reserve("b", now=1.0)  # someone else is unaffected
    with pytest.raises(quota.QuotaExceeded):
        quota.check_and_reserve("a", now=2.0)


def test_daily_limit_uses_hydrated_count(monkeypatch, configured):
    monkeypatch.setattr(configured, "ai_calls_per_day", 5)
    monkeypatch.setattr(quota, "_hydrate_day_count", lambda user_id, day: 5)
    with pytest.raises(quota.QuotaExceeded) as exc:
        quota.check_and_reserve("heavy", now=1.0)
    assert "today" in exc.value.message.lower()


def test_quota_fails_open_when_the_audit_store_is_down(monkeypatch):
    monkeypatch.undo()  # use the real hydrate, with a broken database
    import app.core.supabase_admin as admin

    class Broken:
        def select(self, *a, **k):
            raise RuntimeError("db down")

    monkeypatch.setattr(admin, "SupabaseAdmin", Broken)
    assert quota._hydrate_day_count("u", "2026-10-28") == 0


# ------------------------------------------------------ gemini wrapper
def test_api_key_is_sent_in_a_header_never_the_url(monkeypatch):
    seen = {}

    def fake_post(model, payload, timeout):
        seen["payload"] = payload
        return ok()

    monkeypatch.setattr(gemini, "_post", fake_post)
    # Exercise the real `_post` too, via httpx.post.
    captured = {}

    def fake_httpx_post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return ok()

    monkeypatch.undo()
    monkeypatch.setattr(get_settings(), "gemini_api_key", "secret-key-123")
    monkeypatch.setattr(gemini.httpx, "post", fake_httpx_post)
    gemini.generate_text("hi")
    assert "secret-key-123" not in captured["url"]
    assert "key=" not in captured["url"]
    assert captured["headers"]["x-goog-api-key"] == "secret-key-123"


def test_json_mode_and_thinking_budget_reach_the_request(monkeypatch):
    seen = {}

    def fake_post(model, payload, timeout):
        seen["config"] = payload["generationConfig"]
        return ok('{"a": 1}')

    monkeypatch.setattr(gemini, "_post", fake_post)
    gemini.generate_text("hi", json_mode=True, thinking_budget=0)
    assert seen["config"]["responseMimeType"] == "application/json"
    assert seen["config"]["thinkingConfig"] == {"thinkingBudget": 0}
    assert seen["config"]["temperature"] <= 0.3


def test_model_rejecting_thinking_option_is_retried_without_it(monkeypatch):
    configs = []

    def fake_post(model, payload, timeout):
        configs.append(payload["generationConfig"])
        if "thinkingConfig" in payload["generationConfig"]:
            return FakeResponse(400, text="Unknown field thinkingConfig")
        return ok("fine")

    monkeypatch.setattr(gemini, "_post", fake_post)
    assert gemini.generate_text("hi", thinking_budget=0) == "fine"
    assert len(configs) == 2 and "thinkingConfig" not in configs[1]


def test_safety_block_falls_back_then_raises_a_safe_error(monkeypatch):
    blocked = FakeResponse(
        200, {"candidates": [{"finishReason": "SAFETY"}], "promptFeedback": {"blockReason": "SAFETY"}}
    )
    calls = []

    def fake_post(model, payload, timeout):
        calls.append(model)
        return blocked

    monkeypatch.setattr(gemini, "_post", fake_post)
    with pytest.raises(gemini.GeminiUnavailable) as exc:
        gemini.generate_text("hi")
    assert len(calls) == 2  # primary, then fallback
    assert "SAFETY" not in str(exc.value)

    # Fallback answers when only the primary is blocked.
    def primary_blocked(model, payload, timeout):
        return blocked if model == get_settings().gemini_primary_model else ok("fallback ok")

    monkeypatch.setattr(gemini, "_post", primary_blocked)
    assert gemini.generate_text("hi") == "fallback ok"


def test_upstream_error_body_never_appears_in_the_exception(monkeypatch):
    monkeypatch.setattr(
        gemini, "_post", lambda *a, **k: FakeResponse(500, text="INTERNAL: key AIza-leaky-body")
    )
    with pytest.raises(gemini.GeminiUnavailable) as exc:
        gemini.generate_text("hi")
    assert "AIza" not in str(exc.value) and "leaky" not in str(exc.value)


# ----------------------------------------------------------- routers
@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: CurrentUser("user-q", "q@example.com", {})
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_calculate_foods_returns_429_with_retry_after_when_over_quota(client, monkeypatch):
    def over(*args, **kwargs):
        raise quota.QuotaExceeded("slow down", 42)

    monkeypatch.setattr("app.routers.ai_food.generate_text", over)
    resp = client.post("/api/ai/calculate-foods", json={"text": "2 eggs"})
    assert resp.status_code == 429
    assert resp.headers["retry-after"] == "42"
    assert resp.json()["detail"] == "slow down"


def test_ai_unavailable_returns_a_fixed_message_without_provider_details(client, monkeypatch):
    def boom(*args, **kwargs):
        raise gemini.GeminiUnavailable("primary=Gemini x returned 500 key=AIza-secret")

    monkeypatch.setattr("app.routers.ai_food.generate_text", boom)
    resp = client.post("/api/ai/calculate-foods", json={"text": "2 eggs"})
    assert resp.status_code == 503
    assert "AIza" not in resp.text and "primary" not in resp.text


def test_invalid_token_message_is_generic():
    c = TestClient(app)
    resp = c.get("/api/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert resp.status_code in (401, 500)
    assert "Invalid or expired token" in resp.text or resp.status_code == 500
    assert "Not enough segments" not in resp.text and "Invalid header" not in resp.text

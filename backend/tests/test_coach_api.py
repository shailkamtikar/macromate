"""End-to-end tests for /api/ai/coach/* against the real database and,
for the open-ended question, the real Gemini API."""

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin
from app.main import app

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url or not settings.supabase_service_role_key,
    reason="Supabase credentials not configured",
)


@pytest.fixture
def onboarded_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-coach-test-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    create_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    user_id = create_resp.json()["id"]

    db = SupabaseAdmin()
    db.insert(
        "profiles",
        {
            "id": user_id,
            "username": f"coachtest{uuid.uuid4().hex[:6]}",
            "sex": "male",
            "age_years": 28,
            "height_cm": 178,
            "activity_level": "moderate",
            "goal": "maintain",
            "target_calories": 2200,
            "target_protein_g": 160,
            "target_carbs_g": 220,
            "target_fat_g": 70,
        },
    )

    try:
        signin_resp = httpx.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_service_role_key},
            json={"email": email, "password": password},
            timeout=15,
        )
        assert signin_resp.status_code == 200
        yield {"Authorization": f"Bearer {signin_resp.json()['access_token']}"}
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            timeout=15,
        )


@pytest.fixture
def client():
    return TestClient(app)


def test_fast_path_question_answers_deterministically_and_persists(
    client, onboarded_user
):
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "How much protein do I have left?"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "160g" in body["content"]  # no food logged yet -> full target remaining

    history = client.get("/api/ai/coach/history", headers=onboarded_user)
    assert history.status_code == 200
    roles = [m["role"] for m in history.json()]
    assert roles == ["user", "assistant"]


@pytest.mark.skipif(not settings.gemini_api_key, reason="GEMINI_API_KEY not configured")
def test_open_ended_question_uses_gemini_with_injected_context(client, onboarded_user):
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "Give me one quick tip to hit my protein goal today."},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["content"]) > 0

    history = client.get("/api/ai/coach/history", headers=onboarded_user).json()
    assert len(history) == 2

"""End-to-end test for POST /api/ai/generate-diet against the real Gemini
API and database."""

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin
from app.main import app

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url
    or not settings.supabase_service_role_key
    or not settings.gemini_api_key,
    reason="Supabase or Gemini credentials not configured",
)


@pytest.fixture
def onboarded_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-diet-test-{uuid.uuid4().hex[:10]}@example.com"
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
            "username": f"diettest{uuid.uuid4().hex[:6]}",
            "sex": "female",
            "age_years": 30,
            "height_cm": 165,
            "activity_level": "light",
            "goal": "cut",
            "target_calories": 1700,
            "target_protein_g": 130,
            "target_carbs_g": 150,
            "target_fat_g": 55,
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


def test_generate_vegetarian_diet_respects_target_and_dietary_mode(client, onboarded_user):
    resp = client.post(
        "/api/ai/generate-diet",
        headers=onboarded_user,
        json={"dietary_mode": "vegetarian"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["target"]["calories"] == 1700  # from the real profile, not invented
    assert len(body["meals"]) >= 1
    for meal in body["meals"]:
        forbidden = ["chicken", "beef", "fish", "mutton", "pork", "shrimp", "prawn"]
        desc_lower = meal["description"].lower()
        assert not any(word in desc_lower for word in forbidden), meal["description"]

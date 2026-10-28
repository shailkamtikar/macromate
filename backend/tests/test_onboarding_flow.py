"""Mirrors exactly what frontend/src/app/onboarding/page.tsx does after a
real signup: upsert profiles, insert the first weight_log, both via the
anon key + user JWT (RLS-scoped), against the live database. Regression
test for the profile-persistence path — not a mock of it.
"""

import uuid

import httpx
import pytest

from app.core.config import get_settings

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url
    or not settings.supabase_service_role_key
    or not settings.supabase_anon_key,
    reason="Supabase credentials not configured",
)


@pytest.fixture
def real_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        **({} if settings.supabase_service_role_key.startswith("sb_secret_") else {"Authorization": f"Bearer {settings.supabase_service_role_key}"}),
    }
    email = f"macromate-onboard-test-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"

    create_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    user_id = create_resp.json()["id"]

    try:
        signin_resp = httpx.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_service_role_key},
            json={"email": email, "password": password},
            timeout=15,
        )
        assert signin_resp.status_code == 200, signin_resp.text
        yield {"id": user_id, "token": signin_resp.json()["access_token"]}
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            timeout=15,
        )


def test_onboarding_persists_profile_and_first_weight_log(real_user):
    """Onboarding goes through PUT /api/profile (the server computes and stores
    the targets and the first weight log); the browser reads its own profile
    back directly and can no longer write either itself."""
    from fastapi.testclient import TestClient

    from app.main import app

    api_headers = {"Authorization": f"Bearer {real_user['token']}"}
    client = TestClient(app)
    saved = client.put(
        "/api/profile",
        headers=api_headers,
        json={
            "username": f"tester_{uuid.uuid4().hex[:6]}",
            "sex": "male",
            "age_years": 28,
            "height_cm": 178,
            "weight_kg": 75,
            "activity_level": "moderate",
            "goal": "maintain",
        },
    )
    assert saved.status_code == 200, saved.text
    expected_calories = saved.json()["profile"]["target_calories"]
    assert expected_calories > 1200

    rest = {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {real_user['token']}",
        "Content-Type": "application/json",
    }
    read_resp = httpx.get(
        f"{settings.supabase_url}/rest/v1/profiles?id=eq.{real_user['id']}",
        headers=rest,
        timeout=15,
    )
    assert read_resp.status_code == 200
    rows = read_resp.json()
    assert len(rows) == 1
    assert rows[0]["target_calories"] == expected_calories

    weights = httpx.get(
        f"{settings.supabase_url}/rest/v1/weight_logs?user_id=eq.{real_user['id']}",
        headers=rest,
        timeout=15,
    ).json()
    assert [w["weight_kg"] for w in weights] == [75]

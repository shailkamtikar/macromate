"""End-to-end auth test against the real, live Supabase project — no mocks.

Creates a throwaway user via the Supabase Auth admin API, signs in to get a
real access token, and verifies our own JWT-verification pipeline
(app/core/auth.py) accepts it and rejects everything else. The test user is
deleted afterwards regardless of outcome.

Skips automatically if Supabase isn't configured, so the suite still runs
in environments without those credentials.
"""

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url or not settings.supabase_service_role_key,
    reason="Supabase credentials not configured",
)


@pytest.fixture
def real_access_token():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-test-{uuid.uuid4().hex[:12]}@example.com"
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
        yield signin_resp.json()["access_token"]
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            timeout=15,
        )


def test_me_rejects_missing_token():
    client = TestClient(app)
    resp = client.get("/api/me")
    assert resp.status_code == 401


def test_me_rejects_garbage_token():
    client = TestClient(app)
    resp = client.get("/api/me", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert resp.status_code == 401


def test_me_accepts_real_supabase_session(real_access_token):
    client = TestClient(app)
    resp = client.get(
        "/api/me", headers={"Authorization": f"Bearer {real_access_token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"]
    assert body["email"].startswith("macromate-test-")

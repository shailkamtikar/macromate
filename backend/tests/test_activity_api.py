"""End-to-end test for /api/activity-logs against the real database."""

import uuid
from datetime import date, timedelta

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
def auth_headers():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-activity-test-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    create_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    user_id = create_resp.json()["id"]
    try:
        signin_resp = httpx.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_service_role_key},
            json={"email": email, "password": password},
            timeout=15,
        )
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


def test_manual_activity_upsert_and_list(client, auth_headers):
    today = date.today()
    created = client.put(
        "/api/activity-logs",
        headers=auth_headers,
        json={"activity_date": today.isoformat(), "steps": 8000, "workout_minutes": 30},
    )
    assert created.status_code == 200, created.text
    assert created.json()["source"] == "manual"
    assert created.json()["steps"] == 8000

    # Re-submitting the same date updates rather than duplicates.
    updated = client.put(
        "/api/activity-logs",
        headers=auth_headers,
        json={"activity_date": today.isoformat(), "steps": 9500},
    )
    assert updated.status_code == 200

    listed = client.get(
        "/api/activity-logs",
        headers=auth_headers,
        params={"start": (today - timedelta(days=1)).isoformat(), "end": today.isoformat()},
    )
    assert listed.status_code == 200
    matching = [a for a in listed.json() if a["activity_date"] == today.isoformat()]
    assert len(matching) == 1  # confirms upsert, not duplicate insert
    assert matching[0]["steps"] == 9500

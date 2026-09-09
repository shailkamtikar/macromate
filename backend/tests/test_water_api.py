"""End-to-end tests for /api/glass-sizes and /api/water-logs against the
real live Supabase project."""

import uuid
from datetime import datetime, timezone

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


def _create_and_sign_in_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-water-test-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"

    create_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    user_id = create_resp.json()["id"]

    signin_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_service_role_key},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert signin_resp.status_code == 200, signin_resp.text
    return user_id, signin_resp.json()["access_token"], admin_headers


@pytest.fixture
def two_users():
    a_id, a_token, admin_headers = _create_and_sign_in_user()
    b_id, b_token, _ = _create_and_sign_in_user()
    try:
        yield {
            "a": {"id": a_id, "headers": {"Authorization": f"Bearer {a_token}"}},
            "b": {"id": b_id, "headers": {"Authorization": f"Bearer {b_token}"}},
        }
    finally:
        for uid in (a_id, b_id):
            httpx.delete(
                f"{settings.supabase_url}/auth/v1/admin/users/{uid}",
                headers=admin_headers,
                timeout=15,
            )


@pytest.fixture
def client():
    return TestClient(app)


def test_custom_glass_size_crud(client, two_users):
    a = two_users["a"]

    created = client.post(
        "/api/glass-sizes",
        headers=a["headers"],
        json={"label": "Big bottle", "volume_ml": 1000},
    )
    assert created.status_code == 200, created.text
    glass_id = created.json()["id"]

    listed = client.get("/api/glass-sizes", headers=a["headers"])
    assert listed.status_code == 200
    assert any(g["id"] == glass_id for g in listed.json())

    deleted = client.delete(f"/api/glass-sizes/{glass_id}", headers=a["headers"])
    assert deleted.status_code == 204

    listed_after = client.get("/api/glass-sizes", headers=a["headers"])
    assert not any(g["id"] == glass_id for g in listed_after.json())


def test_glass_sizes_are_private_per_user(client, two_users):
    a, b = two_users["a"], two_users["b"]

    client.post(
        "/api/glass-sizes", headers=a["headers"], json={"label": "A's cup", "volume_ml": 250}
    )

    b_list = client.get("/api/glass-sizes", headers=b["headers"])
    assert b_list.status_code == 200
    assert all(g["label"] != "A's cup" for g in b_list.json())


def test_log_water_and_daily_summary(client, two_users):
    a = two_users["a"]
    today = datetime.now(timezone.utc).date().isoformat()

    first = client.post("/api/water-logs", headers=a["headers"], json={"volume_ml": 250})
    assert first.status_code == 200
    second = client.post("/api/water-logs", headers=a["headers"], json={"volume_ml": 500})
    assert second.status_code == 200

    summary = client.get(
        "/api/water-logs", headers=a["headers"], params={"date": today}
    )
    assert summary.status_code == 200
    body = summary.json()
    assert body["total_ml"] == 750
    assert len(body["logs"]) == 2


def test_user_b_cannot_delete_user_a_water_log(client, two_users):
    a, b = two_users["a"], two_users["b"]

    log_resp = client.post("/api/water-logs", headers=a["headers"], json={"volume_ml": 300})
    log_id = log_resp.json()["id"]

    # Attempting to delete via B's auth should not remove A's row — the
    # route scopes the delete by user_id, so this is a silent no-op rather
    # than a 403, matching PostgREST's RLS-filtered-update-affects-0-rows
    # behavior used elsewhere in this API.
    client.delete(f"/api/water-logs/{log_id}", headers=b["headers"])

    today = datetime.now(timezone.utc).date().isoformat()
    a_summary = client.get("/api/water-logs", headers=a["headers"], params={"date": today})
    assert any(l["id"] == log_id for l in a_summary.json()["logs"])

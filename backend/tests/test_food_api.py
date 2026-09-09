"""End-to-end tests for /api/foods* against the real live Supabase project.
Covers the two product-critical behaviors: duplicate detection before
creating a custom food, and food_logs preserving a nutrition snapshot that
survives a later edit to the source food_items row.
"""

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
def auth_headers():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-food-test-{uuid.uuid4().hex[:10]}@example.com"
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
        token = signin_resp.json()["access_token"]
        yield {"Authorization": f"Bearer {token}"}
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            timeout=15,
        )


@pytest.fixture
def client():
    return TestClient(app)


def _cleanup_food(food_id: str):
    db = SupabaseAdmin()
    db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_create_food_then_duplicate_is_flagged_not_silently_created(
    client, auth_headers
):
    unique_name = f"__test_apple_pie_{uuid.uuid4().hex[:8]}"

    first = client.post(
        "/api/foods",
        headers=auth_headers,
        json={
            "name": unique_name,
            "serving_description": "1 slice",
            "calories": 300,
            "protein_g": 3,
            "carbs_g": 40,
            "fat_g": 15,
        },
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["created"] is not None
    food_id = body["created"]["id"]

    try:
        # Same name again, no force: should be flagged as a likely
        # duplicate rather than silently creating a second entry.
        second = client.post(
            "/api/foods",
            headers=auth_headers,
            json={
                "name": unique_name,
                "serving_description": "1 slice",
                "calories": 305,
                "protein_g": 3,
                "carbs_g": 41,
                "fat_g": 15,
            },
        )
        assert second.status_code == 200
        second_body = second.json()
        assert second_body["created"] is None
        assert len(second_body["possible_duplicates"]) >= 1
        assert second_body["possible_duplicates"][0]["id"] == food_id

        # With force=true, it creates anyway.
        forced = client.post(
            "/api/foods",
            headers=auth_headers,
            json={
                "name": unique_name,
                "serving_description": "1 slice",
                "calories": 305,
                "protein_g": 3,
                "carbs_g": 41,
                "fat_g": 15,
                "force": True,
            },
        )
        assert forced.status_code == 200
        forced_body = forced.json()
        assert forced_body["created"] is not None
        _cleanup_food(forced_body["created"]["id"])
    finally:
        _cleanup_food(food_id)


def test_food_log_snapshot_survives_later_food_item_edit(client, auth_headers):
    db = SupabaseAdmin()
    unique_name = f"__test_snapshot_food_{uuid.uuid4().hex[:8]}"

    created = client.post(
        "/api/foods",
        headers=auth_headers,
        json={
            "name": unique_name,
            "serving_description": "1 bowl",
            "calories": 200,
            "protein_g": 10,
            "carbs_g": 20,
            "fat_g": 5,
            # This test validates snapshot integrity, not duplicate
            # detection — force=True keeps it independent of leftover
            # same-prefix rows from a prior interrupted test run.
            "force": True,
        },
    ).json()["created"]
    food_id = created["id"]

    try:
        logged = client.post(
            "/api/food-logs",
            headers=auth_headers,
            json={"food_item_id": food_id, "meal_type": "lunch", "quantity": 2},
        )
        assert logged.status_code == 200, logged.text
        log_body = logged.json()
        assert log_body["calories"] == 400  # 200 * 2
        assert log_body["protein_g"] == 20

        # Now edit the underlying food_items row directly (simulating a
        # later correction to the shared database).
        db.update("food_items", {"id": f"eq.{food_id}"}, {"calories": 9999})

        # The historical log must be unchanged. logged_at defaults to "now"
        # (UTC) at insert time, so query today's date.
        from datetime import datetime, timezone

        today = datetime.now(timezone.utc).date().isoformat()
        logs = client.get(
            "/api/food-logs", headers=auth_headers, params={"date": today}
        )
        assert logs.status_code == 200
        matching = [l for l in logs.json() if l["id"] == log_body["id"]]
        assert len(matching) == 1
        assert matching[0]["calories"] == 400  # unchanged despite the edit above
        assert matching[0]["food_name"] == unique_name
    finally:
        # food_items.food_item_id has ON DELETE RESTRICT (deliberately —
        # protects historical logs from an orphaned reference), so the log
        # row must be cleaned up before the food item it references.
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        _cleanup_food(food_id)

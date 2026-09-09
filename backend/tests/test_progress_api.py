"""End-to-end test for GET /api/progress/weekly against the real database."""

import uuid
from datetime import date, datetime, time, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin
from app.domain.progress import week_bounds
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
    email = f"macromate-progress-test-{uuid.uuid4().hex[:10]}@example.com"
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
            "username": f"progresstest{uuid.uuid4().hex[:6]}",
            "sex": "male",
            "age_years": 28,
            "height_cm": 178,
            "activity_level": "moderate",
            "goal": "maintain",
            "target_calories": 2000,
            "target_protein_g": 150,
            "target_carbs_g": 200,
            "target_fat_g": 65,
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
        yield {"headers": {"Authorization": f"Bearer {signin_resp.json()['access_token']}"}, "user_id": user_id}
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            timeout=15,
        )


@pytest.fixture
def client():
    return TestClient(app)


def test_weekly_report_reflects_real_logged_data(client, onboarded_user):
    db = SupabaseAdmin()
    user_id = onboarded_user["user_id"]

    today = datetime.now(timezone.utc).date()
    week_start, _ = week_bounds(today)

    # Log exactly at the target on two days this week (need a real seeded
    # food_item to satisfy the FK).
    food_id = db.insert(
        "food_items",
        {
            "name": f"__progtest_food_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 serving",
            "calories": 2000,
            "protein_g": 150,
            "carbs_g": 200,
            "fat_g": 65,
        },
    )[0]["id"]

    from datetime import timedelta

    for offset in (0, 1):
        day = week_start + timedelta(days=offset)
        logged_at = datetime.combine(day, time(12, 0), tzinfo=timezone.utc)
        db.insert(
            "food_logs",
            {
                "user_id": user_id,
                "food_item_id": food_id,
                "meal_type": "lunch",
                "quantity": 1,
                "calories": 2000,
                "protein_g": 150,
                "carbs_g": 200,
                "fat_g": 65,
                "logged_at": logged_at.isoformat(),
            },
        )

    try:
        resp = client.get(
            "/api/progress/weekly",
            headers=onboarded_user["headers"],
            params={"ref_date": today.isoformat()},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["current"]["days_goal_hit"] >= 1
        assert body["current"]["avg_calories"] >= 0
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})

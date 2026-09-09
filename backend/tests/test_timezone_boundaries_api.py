"""Live end-to-end proof that /api/food-logs attributes a log to the
user's *local* calendar day, not the server's UTC day. Regression test for
a real bug: every day-boundary in the app used to be computed in UTC
regardless of profile.timezone, so anyone in a timezone ahead of UTC (e.g.
Asia/Kolkata, UTC+5:30) had food logged shortly after local midnight
silently attributed to "yesterday" on the Today dashboard.
"""

import uuid
from datetime import datetime, timezone

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
def client():
    return TestClient(app)


@pytest.fixture
def ist_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-tz-test-{uuid.uuid4().hex[:10]}@example.com"
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
            "username": f"tzuser{uuid.uuid4().hex[:8]}",
            "sex": "male",
            "age_years": 30,
            "height_cm": 175,
            "activity_level": "moderate",
            "goal": "maintain",
            "target_calories": 2200,
            "target_protein_g": 160,
            "target_carbs_g": 220,
            "target_fat_g": 70,
            "timezone": "Asia/Kolkata",
        },
    )

    signin_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_service_role_key},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert signin_resp.status_code == 200, signin_resp.text
    token = signin_resp.json()["access_token"]

    try:
        yield {"id": user_id, "headers": {"Authorization": f"Bearer {token}"}}
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            timeout=15,
        )


def _cleanup_food(food_id: str):
    db = SupabaseAdmin()
    db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_food_logged_just_after_local_midnight_shows_up_as_today_not_yesterday(
    client, ist_user
):
    db = SupabaseAdmin()
    unique_name = f"__test_tz_food_{uuid.uuid4().hex[:8]}"
    food = db.insert(
        "food_items",
        {
            "name": unique_name,
            "serving_description": "1 bowl",
            "calories": 150,
            "protein_g": 8,
            "carbs_g": 20,
            "fat_g": 3,
            "created_by": ist_user["id"],
        },
    )[0]

    try:
        # Pick "now" in UTC, then construct a UTC instant that is definitely
        # still within the last few hours of the *previous* UTC calendar
        # day but already the *next* calendar day in IST (UTC+5:30) —
        # 19:30 UTC is 01:00 IST the following day.
        now_utc = datetime.now(timezone.utc)
        utc_yesterday_late = now_utc.replace(
            hour=19, minute=30, second=0, microsecond=0
        )
        # If "now" itself is already past 19:30 UTC, step back a day so the
        # instant we log is unambiguously in the past.
        if now_utc >= utc_yesterday_late:
            from datetime import timedelta

            utc_yesterday_late -= timedelta(days=1)

        from zoneinfo import ZoneInfo

        ist_local_date = utc_yesterday_late.astimezone(ZoneInfo("Asia/Kolkata")).date()
        utc_calendar_date = utc_yesterday_late.date()
        assert ist_local_date != utc_calendar_date, "test instant must straddle the UTC/IST day boundary"

        log_row = db.insert(
            "food_logs",
            {
                "user_id": ist_user["id"],
                "food_item_id": food["id"],
                "meal_type": "snack",
                "quantity": 1,
                "calories": 150,
                "protein_g": 8,
                "carbs_g": 20,
                "fat_g": 3,
                "logged_at": utc_yesterday_late.isoformat(),
            },
        )[0]

        # Querying by the IST local date must return this log...
        ist_day_result = client.get(
            "/api/food-logs",
            headers=ist_user["headers"],
            params={"date": ist_local_date.isoformat()},
        )
        assert ist_day_result.status_code == 200
        assert any(l["id"] == log_row["id"] for l in ist_day_result.json())

        # ...while querying by the UTC calendar date must NOT — proving the
        # endpoint is genuinely using the user's timezone, not silently
        # matching on a wider window.
        utc_day_result = client.get(
            "/api/food-logs",
            headers=ist_user["headers"],
            params={"date": utc_calendar_date.isoformat()},
        )
        assert utc_day_result.status_code == 200
        assert all(l["id"] != log_row["id"] for l in utc_day_result.json())
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food['id']}"})
        _cleanup_food(food["id"])

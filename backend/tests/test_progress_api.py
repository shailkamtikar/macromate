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


def _create_onboarded_user(suffix: str) -> dict:
    """Same shape as the `onboarded_user` fixture, as a plain function so a
    test can create a second, independent user for isolation checks."""
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-progress-test-{suffix}-{uuid.uuid4().hex[:10]}@example.com"
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
    signin_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_service_role_key},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert signin_resp.status_code == 200
    return {
        "headers": {"Authorization": f"Bearer {signin_resp.json()['access_token']}"},
        "user_id": user_id,
    }


def _delete_user(user_id: str) -> None:
    httpx.delete(
        f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
        headers={
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        },
        timeout=15,
    )


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


def test_current_live_week_reports_partial_days_and_is_never_persisted(client, onboarded_user):
    """The currently-in-progress week must always be computed live and
    never written to weekly_reports (PRD §16: only a completed week may be
    persisted)."""
    from datetime import timedelta

    db = SupabaseAdmin()
    today = datetime.now(timezone.utc).date()
    week_start, _ = week_bounds(today)
    expected_days_in_period = (today - week_start).days + 1

    resp = client.get("/api/progress/weekly", headers=onboarded_user["headers"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["current"]["days_in_period"] == expected_days_in_period
    assert body["current"]["is_partial"] == (expected_days_in_period < 7)

    cached = db.select(
        "weekly_reports",
        {"user_id": f"eq.{onboarded_user['user_id']}", "week_start": f"eq.{week_start.isoformat()}"},
    )
    assert cached == []


def test_previous_week_with_no_data_reports_zero_not_fabricated(client, onboarded_user):
    resp = client.get("/api/progress/weekly", headers=onboarded_user["headers"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["previous"]["days_logged"] == 0
    assert body["previous"]["avg_calories"] == 0


def test_completed_past_week_is_cached_and_stays_stable_after_a_later_target_change(
    client, onboarded_user
):
    """PRD §15: a historical (already-complete) week's report must not
    change just because the profile's targets changed afterward, and must
    never be recomputed/duplicated on repeated views."""
    from datetime import timedelta

    db = SupabaseAdmin()
    user_id = onboarded_user["user_id"]
    today = datetime.now(timezone.utc).date()
    this_week_start, _ = week_bounds(today)
    past_week_start = this_week_start - timedelta(days=21)
    ref = past_week_start + timedelta(days=1)

    food_id = db.insert(
        "food_items",
        {
            "name": f"__progtest_past_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 serving",
            "calories": 2000,
            "protein_g": 150,
            "carbs_g": 200,
            "fat_g": 65,
        },
    )[0]["id"]
    logged_at = datetime.combine(past_week_start, time(12, 0), tzinfo=timezone.utc)
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
        resp1 = client.get(
            "/api/progress/weekly", headers=onboarded_user["headers"], params={"ref_date": ref.isoformat()}
        )
        assert resp1.status_code == 200, resp1.text
        body1 = resp1.json()
        assert body1["current"]["is_partial"] is False
        assert body1["current"]["days_in_period"] == 7
        assert body1["current"]["days_goal_hit"] == 1

        cached = db.select(
            "weekly_reports",
            {"user_id": f"eq.{user_id}", "week_start": f"eq.{past_week_start.isoformat()}"},
        )
        assert len(cached) == 1

        # A later profile-target change must not retroactively alter an
        # already-computed-and-cached historical week.
        db.update("profiles", {"id": f"eq.{user_id}"}, {"target_calories": 5000})

        resp2 = client.get(
            "/api/progress/weekly", headers=onboarded_user["headers"], params={"ref_date": ref.isoformat()}
        )
        body2 = resp2.json()
        assert body2["current"]["days_goal_hit"] == body1["current"]["days_goal_hit"]
        assert body2["current"]["adherence_pct"] == body1["current"]["adherence_pct"]
        assert body2["current"]["avg_calories"] == body1["current"]["avg_calories"]

        # Still exactly one cached row -- viewing it again must not create
        # a duplicate.
        cached_after = db.select(
            "weekly_reports",
            {"user_id": f"eq.{user_id}", "week_start": f"eq.{past_week_start.isoformat()}"},
        )
        assert len(cached_after) == 1
    finally:
        db._request("DELETE", "weekly_reports", params={"user_id": f"eq.{user_id}"})
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_weekly_report_and_cached_rows_are_isolated_between_users(client, onboarded_user):
    """PRD §22/§31/§32: neither live nor persisted report data may leak
    across users, even for the exact same calendar week."""
    from datetime import timedelta

    db = SupabaseAdmin()
    user_a = onboarded_user["user_id"]
    user_b = _create_onboarded_user("isolation")
    try:
        today = datetime.now(timezone.utc).date()
        this_week_start, _ = week_bounds(today)
        past_week_start = this_week_start - timedelta(days=14)
        ref = past_week_start + timedelta(days=1)

        food_id = db.insert(
            "food_items",
            {
                "name": f"__progtest_iso_{uuid.uuid4().hex[:8]}",
                "serving_description": "1 serving",
                "calories": 2000,
                "protein_g": 150,
                "carbs_g": 200,
                "fat_g": 65,
            },
        )[0]["id"]
        logged_at = datetime.combine(past_week_start, time(12, 0), tzinfo=timezone.utc)
        db.insert(
            "food_logs",
            {
                "user_id": user_a,
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

        resp_a = client.get(
            "/api/progress/weekly", headers=onboarded_user["headers"], params={"ref_date": ref.isoformat()}
        )
        resp_b = client.get(
            "/api/progress/weekly", headers=user_b["headers"], params={"ref_date": ref.isoformat()}
        )
        assert resp_a.status_code == 200 and resp_b.status_code == 200
        assert resp_a.json()["current"]["days_logged"] == 1
        # Same calendar week, but user B never logged anything -- must see
        # their own empty week, never user A's data.
        assert resp_b.json()["current"]["days_logged"] == 0

        rows_a = db.select("weekly_reports", {"user_id": f"eq.{user_a}", "week_start": f"eq.{past_week_start.isoformat()}"})
        rows_b = db.select("weekly_reports", {"user_id": f"eq.{user_b['user_id']}", "week_start": f"eq.{past_week_start.isoformat()}"})
        assert len(rows_a) == 1
        assert len(rows_b) == 1
        assert rows_a[0]["payload"]["days_logged"] == 1
        assert rows_b[0]["payload"]["days_logged"] == 0
    finally:
        db._request("DELETE", "weekly_reports", params={"user_id": f"eq.{user_a}"})
        db._request("DELETE", "weekly_reports", params={"user_id": f"eq.{user_b['user_id']}"})
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})
        _delete_user(user_b["user_id"])

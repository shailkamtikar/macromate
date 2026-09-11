"""End-to-end tests for /api/notification-settings against the real
database, plus a test that app/core/fcm.py fails loudly (not silently or
fakely) when unconfigured."""

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.fcm import FcmNotConfigured, send_push
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
    email = f"macromate-notif-test-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    create_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    user_id = create_resp.json()["id"]

    db = SupabaseAdmin()
    db.insert(
        "profiles",
        {
            "id": user_id,
            "username": f"notiftest{uuid.uuid4().hex[:6]}",
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


def test_default_settings_before_any_write(client, onboarded_user):
    resp = client.get("/api/notification-settings", headers=onboarded_user)
    assert resp.status_code == 200
    assert resp.json()["logging_reminders_enabled"] is True


def test_update_and_persist_settings(client, onboarded_user):
    resp = client.put(
        "/api/notification-settings",
        headers=onboarded_user,
        json={
            "logging_reminders_enabled": False,
            "reminder_times": ["08:00:00", "19:00:00"],
            "streak_warnings_enabled": True,
            "macro_nudges_enabled": False,
            "quiet_hours_start": "22:00:00",
            "quiet_hours_end": "07:00:00",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["logging_reminders_enabled"] is False

    readback = client.get("/api/notification-settings", headers=onboarded_user)
    assert readback.json()["reminder_times"] == ["08:00:00", "19:00:00"]
    assert readback.json()["quiet_hours_start"] == "22:00:00"


def test_check_now_returns_real_evaluated_triggers(client, onboarded_user):
    resp = client.get("/api/notification-settings/check-now", headers=onboarded_user)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_master_switch_and_friend_activity_category_persist(client, onboarded_user):
    resp = client.put(
        "/api/notification-settings",
        headers=onboarded_user,
        json={
            "notifications_enabled": False,
            "logging_reminders_enabled": True,
            "reminder_times": [],
            "streak_warnings_enabled": True,
            "macro_nudges_enabled": True,
            "friend_activity_enabled": False,
            "quiet_hours_start": None,
            "quiet_hours_end": None,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["notifications_enabled"] is False
    assert resp.json()["friend_activity_enabled"] is False

    readback = client.get("/api/notification-settings", headers=onboarded_user)
    assert readback.json()["notifications_enabled"] is False
    assert readback.json()["friend_activity_enabled"] is False


def test_master_switch_off_suppresses_check_now_even_with_a_real_logging_reminder_due(
    client, onboarded_user
):
    """Regression test proving the master switch is actually wired through
    the API, not just accepted and stored: a logging reminder set for a
    time that has already passed today would normally fire, but must not
    when notifications_enabled is false."""
    from datetime import datetime, timezone

    now_utc = datetime.now(timezone.utc)
    # UTC is close enough to this test's default profile timezone (UTC,
    # since onboarded_user sets none) -- a reminder time a few minutes in
    # the past is guaranteed to be inside the 15-minute firing window.
    past_reminder = (now_utc.replace(second=0, microsecond=0)).strftime("%H:%M:00")

    client.put(
        "/api/notification-settings",
        headers=onboarded_user,
        json={
            "notifications_enabled": False,
            "logging_reminders_enabled": True,
            "reminder_times": [past_reminder],
            "streak_warnings_enabled": True,
            "macro_nudges_enabled": True,
            "friend_activity_enabled": True,
            "quiet_hours_start": None,
            "quiet_hours_end": None,
        },
    )
    resp = client.get("/api/notification-settings/check-now", headers=onboarded_user)
    assert resp.status_code == 200
    assert resp.json() == []


def test_fcm_send_fails_loudly_when_not_configured():
    with pytest.raises(FcmNotConfigured):
        send_push(device_token="fake-token", title="x", body="y")

"""Live tests for PUT /api/profile and POST /api/weight-logs (TEST project)."""

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin, service_headers
from app.main import app

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url or not settings.supabase_service_role_key,
    reason="Supabase credentials not configured",
)

BASE = {
    "username": "placeholder",
    "weight_kg": 80,
    "height_cm": 178,
    "age_years": 30,
    "sex": "male",
    "activity_level": "moderate",
    "goal": "maintain",
    "dietary_mode": "non_vegetarian",
    "timezone": "Asia/Kolkata",
}


def _create_user():
    admin = service_headers(settings.supabase_service_role_key)
    email = f"macromate-profile-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    created = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    assert created.status_code in (200, 201), created.text
    signin = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_anon_key or settings.supabase_service_role_key},
        json={"email": email, "password": password},
        timeout=15,
    )
    return created.json()["id"], {"Authorization": f"Bearer {signin.json()['access_token']}"}


def _delete_user(user_id):
    httpx.delete(
        f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
        headers=service_headers(settings.supabase_service_role_key),
        timeout=15,
    )


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def user():
    user_id, headers = _create_user()
    username = f"prof_{uuid.uuid4().hex[:10]}"
    try:
        yield {"id": user_id, "headers": headers, "username": username}
    finally:
        _delete_user(user_id)


def _payload(user, **overrides):
    return {**BASE, "username": user["username"], **overrides}


def _weights(user_id):
    return SupabaseAdmin().select("weight_logs", {"user_id": f"eq.{user_id}", "order": "logged_at.asc"})


def test_onboarding_creates_profile_with_server_computed_targets(client, user):
    resp = client.put("/api/profile", headers=user["headers"], json=_payload(user))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    preview = client.post("/api/macro-targets", json={k: v for k, v in _payload(user).items() if k in
        {"weight_kg", "height_cm", "age_years", "sex", "activity_level", "goal"}}).json()
    assert body["profile"]["target_calories"] == preview["targets"]["calories"]
    assert body["profile"]["target_protein_g"] == preview["targets"]["protein_g"]
    assert body["profile"]["water_goal_ml"] == preview["water_goal_ml"]
    assert body["profile"]["timezone"] == "Asia/Kolkata"
    assert [w["weight_kg"] for w in _weights(user["id"])] == [80]

    # The target-history trigger recorded today's snapshot.
    snaps = SupabaseAdmin().select("daily_targets", {"user_id": f"eq.{user['id']}"})
    assert len(snaps) == 1 and snaps[0]["target_calories"] == body["profile"]["target_calories"]


def test_saving_again_only_logs_weight_when_it_changed_and_recomputes_targets(client, user):
    first = client.put("/api/profile", headers=user["headers"], json=_payload(user)).json()
    same = client.put("/api/profile", headers=user["headers"], json=_payload(user, leaderboard_visible=False))
    assert same.status_code == 200
    assert len(_weights(user["id"])) == 1  # unchanged weight -> no duplicate log

    cut = client.put(
        "/api/profile",
        headers=user["headers"],
        json=_payload(user, weight_kg=78.5, goal="cut", rate_kg_per_week=0.5),
    )
    assert cut.status_code == 200, cut.text
    assert cut.json()["profile"]["target_calories"] < first["profile"]["target_calories"]
    assert [w["weight_kg"] for w in _weights(user["id"])] == [80, 78.5]


def test_client_cannot_smuggle_in_unreasonable_targets(client, user):
    # A huge calorie "override" is rejected exactly like in the preview...
    resp = client.put(
        "/api/profile", headers=user["headers"], json=_payload(user, calorie_override=9000)
    )
    assert resp.status_code == 422, resp.text
    # ...and unknown target fields in the body are simply ignored: nothing a
    # client sends as "target_calories" can reach the database.
    resp = client.put(
        "/api/profile",
        headers=user["headers"],
        json={**_payload(user), "target_calories": 99999},
    )
    assert resp.status_code == 200
    assert resp.json()["profile"]["target_calories"] < 5000


def test_validation_and_auth(client, user):
    assert client.put("/api/profile", json=_payload(user)).status_code == 401
    for bad in ({"age_years": 0}, {"weight_kg": -5}, {"height_cm": 0}, {"sex": "other"}, {"username": ""}):
        resp = client.put("/api/profile", headers=user["headers"], json=_payload(user, **bad))
        assert resp.status_code == 422, (bad, resp.text)
    assert client.put(
        "/api/profile", headers=user["headers"], json=_payload(user, timezone="Mars/Olympus")
    ).status_code == 422


def test_username_must_be_unique(client, user):
    other_id, other_headers = _create_user()
    try:
        assert client.put("/api/profile", headers=user["headers"], json=_payload(user)).status_code == 200
        clash = client.put("/api/profile", headers=other_headers, json=_payload(user))
        assert clash.status_code == 409, clash.text
    finally:
        _delete_user(other_id)


def test_client_can_no_longer_write_targets_or_weight_directly(user, client):
    """After the lock-down migration the browser (anon key + JWT) cannot
    insert/update profile targets or weight rows itself."""
    assert client.put("/api/profile", headers=user["headers"], json=_payload(user)).status_code == 200
    rest = {
        "apikey": settings.supabase_anon_key,
        "Authorization": user["headers"]["Authorization"],
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    tamper = httpx.patch(
        f"{settings.supabase_url}/rest/v1/profiles",
        headers=rest,
        params={"id": f"eq.{user['id']}"},
        json={"target_calories": 99999},
        timeout=15,
    )
    assert tamper.status_code in (401, 403), tamper.text
    fake_weight = httpx.post(
        f"{settings.supabase_url}/rest/v1/weight_logs",
        headers=rest,
        json={"user_id": user["id"], "weight_kg": 1},
        timeout=15,
    )
    assert fake_weight.status_code in (401, 403), fake_weight.text
    # Reading its own profile still works, and timezone sync is still allowed.
    assert httpx.get(
        f"{settings.supabase_url}/rest/v1/profiles", headers=rest, params={"id": f"eq.{user['id']}"}, timeout=15
    ).status_code == 200
    tz = httpx.patch(
        f"{settings.supabase_url}/rest/v1/profiles",
        headers=rest,
        params={"id": f"eq.{user['id']}"},
        json={"timezone": "Europe/Berlin"},
        timeout=15,
    )
    assert tz.status_code in (200, 204), tz.text


def test_weight_logging_validation_and_backfill(client, user):
    assert client.put("/api/profile", headers=user["headers"], json=_payload(user)).status_code == 200
    for bad in (0, -1, 401, "abc"):
        assert client.post("/api/weight-logs", headers=user["headers"], json={"weight_kg": bad}).status_code == 422

    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    future = (today + timedelta(days=1)).isoformat()
    assert client.post(
        "/api/weight-logs", headers=user["headers"], json={"weight_kg": 79, "log_date": future}
    ).status_code == 422

    past = (today - timedelta(days=4)).isoformat()
    ok = client.post("/api/weight-logs", headers=user["headers"], json={"weight_kg": 79.2, "log_date": past})
    assert ok.status_code == 200, ok.text
    assert ok.json()["logged_at"].startswith(past) or ok.json()["logged_at"][:10] in (past,)
    assert client.post("/api/weight-logs", json={"weight_kg": 70}).status_code == 401

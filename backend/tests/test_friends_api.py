"""End-to-end tests for /api/friends/* against the real database."""

import uuid
from datetime import datetime, time, timedelta, timezone

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


def _create_onboarded_user(username_prefix: str):
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-friend-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    create_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    user_id = create_resp.json()["id"]
    username = f"{username_prefix}{uuid.uuid4().hex[:8]}"

    db = SupabaseAdmin()
    db.insert(
        "profiles",
        {
            "id": user_id,
            "username": username,
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
    token = signin_resp.json()["access_token"]
    return {
        "user_id": user_id,
        "username": username,
        "headers": {"Authorization": f"Bearer {token}"},
    }


@pytest.fixture
def two_users():
    a = _create_onboarded_user("frienda")
    b = _create_onboarded_user("friendb")
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    try:
        yield {"a": a, "b": b}
    finally:
        for u in (a, b):
            httpx.delete(
                f"{settings.supabase_url}/auth/v1/admin/users/{u['user_id']}",
                headers=admin_headers,
                timeout=15,
            )


@pytest.fixture
def client():
    return TestClient(app)


def test_full_friend_request_flow_and_leaderboard(client, two_users):
    a, b = two_users["a"], two_users["b"]

    # A searches for B by (partial) username.
    search = client.get("/api/friends/search", headers=a["headers"], params={"q": b["username"][:6]})
    assert search.status_code == 200
    assert any(r["username"] == b["username"] for r in search.json())

    # A sends a friend request to B.
    req = client.post("/api/friends/request", headers=a["headers"], json={"username": b["username"]})
    assert req.status_code == 200, req.text
    friendship_id = req.json()["id"]
    assert req.json()["status"] == "pending"

    # C (not the addressee) cannot respond to it.
    c = _create_onboarded_user("friendc")
    try:
        forbidden = client.post(
            f"/api/friends/{friendship_id}/respond", headers=c["headers"], json={"accept": True}
        )
        assert forbidden.status_code == 403
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{c['user_id']}",
            headers={"apikey": settings.supabase_service_role_key, "Authorization": f"Bearer {settings.supabase_service_role_key}"},
            timeout=15,
        )

    # B (the real addressee) accepts.
    accept = client.post(
        f"/api/friends/{friendship_id}/respond", headers=b["headers"], json={"accept": True}
    )
    assert accept.status_code == 200
    assert accept.json()["status"] == "accepted"

    # Both now see each other in their friend list.
    a_list = client.get("/api/friends", headers=a["headers"]).json()
    assert any(f["other_username"] == b["username"] and f["status"] == "accepted" for f in a_list)

    # Seed a real food log for A this week so the leaderboard reflects it.
    db = SupabaseAdmin()
    food_id = db.insert(
        "food_items",
        {
            "name": f"__friendtest_food_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 serving",
            "calories": 2000,
            "protein_g": 150,
            "carbs_g": 200,
            "fat_g": 65,
        },
    )[0]["id"]
    week_start, _ = week_bounds(datetime.now(timezone.utc).date())
    db.insert(
        "food_logs",
        {
            "user_id": a["user_id"],
            "food_item_id": food_id,
            "meal_type": "lunch",
            "quantity": 1,
            "calories": 2000,
            "protein_g": 150,
            "carbs_g": 200,
            "fat_g": 65,
            "logged_at": datetime.combine(week_start, time(12, 0), tzinfo=timezone.utc).isoformat(),
        },
    )

    try:
        leaderboard = client.get("/api/friends/leaderboard", headers=a["headers"])
        assert leaderboard.status_code == 200, leaderboard.text
        entries = {e["username"]: e for e in leaderboard.json()}
        assert a["username"] in entries
        assert b["username"] in entries
        assert entries[a["username"]]["discipline_score"] > entries[b["username"]]["discipline_score"]
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_opted_out_friend_excluded_from_leaderboard(client, two_users):
    a, b = two_users["a"], two_users["b"]
    db = SupabaseAdmin()

    # Friend, then B opts out of leaderboard visibility.
    req = client.post("/api/friends/request", headers=a["headers"], json={"username": b["username"]})
    client.post(f"/api/friends/{req.json()['id']}/respond", headers=b["headers"], json={"accept": True})
    db.update("profiles", {"id": f"eq.{b['user_id']}"}, {"leaderboard_visible": False})

    leaderboard = client.get("/api/friends/leaderboard", headers=a["headers"])
    usernames = [e["username"] for e in leaderboard.json()]
    assert b["username"] not in usernames
    assert a["username"] in usernames


def test_cannot_send_friend_request_to_self(client, two_users):
    a = two_users["a"]
    resp = client.post("/api/friends/request", headers=a["headers"], json={"username": a["username"]})
    assert resp.status_code == 400


def test_duplicate_friend_request_is_rejected(client, two_users):
    a, b = two_users["a"], two_users["b"]
    first = client.post("/api/friends/request", headers=a["headers"], json={"username": b["username"]})
    assert first.status_code == 200

    duplicate = client.post("/api/friends/request", headers=a["headers"], json={"username": b["username"]})
    assert duplicate.status_code == 409


def _befriend(client, a, b) -> str:
    req = client.post("/api/friends/request", headers=a["headers"], json={"username": b["username"]})
    assert req.status_code == 200, req.text
    friendship_id = req.json()["id"]
    accept = client.post(f"/api/friends/{friendship_id}/respond", headers=b["headers"], json={"accept": True})
    assert accept.status_code == 200, accept.text
    return friendship_id


def _seed_food_item(db: SupabaseAdmin) -> str:
    return db.insert(
        "food_items",
        {
            "name": f"__friendtest_food_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 serving",
            "calories": 400,
            "protein_g": 30,
            "carbs_g": 40,
            "fat_g": 10,
        },
    )[0]["id"]


def _log_food(db: SupabaseAdmin, user_id: str, food_id: str, meal_type: str, logged_at: datetime) -> None:
    db.insert(
        "food_logs",
        {
            "user_id": user_id,
            "food_item_id": food_id,
            "meal_type": meal_type,
            "quantity": 1,
            "calories": 400,
            "protein_g": 30,
            "carbs_g": 40,
            "fat_g": 10,
            "logged_at": logged_at.isoformat(),
        },
    )


def test_leaderboard_includes_current_streak_days(client, two_users):
    a, b = two_users["a"], two_users["b"]
    db = SupabaseAdmin()
    _befriend(client, a, b)

    food_id = _seed_food_item(db)
    now = datetime.now(timezone.utc)
    try:
        for offset in (0, 1, 2):
            _log_food(db, a["user_id"], food_id, "lunch", now - timedelta(days=offset))

        leaderboard = client.get("/api/friends/leaderboard", headers=a["headers"])
        assert leaderboard.status_code == 200, leaderboard.text
        entries = {e["username"]: e for e in leaderboard.json()}
        assert entries[a["username"]]["current_streak_days"] >= 3
        assert entries[b["username"]]["current_streak_days"] == 0
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_friend_activity_groups_multiple_foods_into_one_item_per_meal(client, two_users):
    a, b = two_users["a"], two_users["b"]
    db = SupabaseAdmin()
    _befriend(client, a, b)

    food_id = _seed_food_item(db)
    now = datetime.now(timezone.utc)
    try:
        # Three separate foods logged to the same meal by B.
        for _ in range(3):
            _log_food(db, b["user_id"], food_id, "lunch", now)

        resp = client.get("/api/friends/activity", headers=a["headers"])
        assert resp.status_code == 200, resp.text
        items = [i for i in resp.json() if i["user_id"] == b["user_id"]]
        assert len(items) == 1
        assert items[0]["meal_type"] == "lunch"
        assert items[0]["item_count"] == 3
        # Never expose nutrition/food details in the activity item.
        assert "calories" not in items[0]
        assert "protein_g" not in items[0]
        assert "food_name" not in items[0]
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_friend_activity_is_only_visible_to_accepted_friends(client, two_users):
    a, b = two_users["a"], two_users["b"]
    db = SupabaseAdmin()
    # No friendship at all between A and B.
    food_id = _seed_food_item(db)
    try:
        _log_food(db, b["user_id"], food_id, "dinner", datetime.now(timezone.utc))

        resp = client.get("/api/friends/activity", headers=a["headers"])
        assert resp.status_code == 200, resp.text
        assert resp.json() == []
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_friend_activity_respects_leaderboard_visible_opt_out(client, two_users):
    a, b = two_users["a"], two_users["b"]
    db = SupabaseAdmin()
    _befriend(client, a, b)
    db.update("profiles", {"id": f"eq.{b['user_id']}"}, {"leaderboard_visible": False})

    food_id = _seed_food_item(db)
    try:
        _log_food(db, b["user_id"], food_id, "breakfast", datetime.now(timezone.utc))

        resp = client.get("/api/friends/activity", headers=a["headers"])
        assert resp.status_code == 200, resp.text
        assert all(i["user_id"] != b["user_id"] for i in resp.json())
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_friend_activity_never_includes_own_meals(client, two_users):
    """The feed is about friends' activity, not a mirror of your own."""
    a, b = two_users["a"], two_users["b"]
    db = SupabaseAdmin()
    _befriend(client, a, b)

    food_id = _seed_food_item(db)
    try:
        _log_food(db, a["user_id"], food_id, "snack", datetime.now(timezone.utc))

        resp = client.get("/api/friends/activity", headers=a["headers"])
        assert resp.status_code == 200, resp.text
        assert all(i["user_id"] != a["user_id"] for i in resp.json())
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food_id}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})

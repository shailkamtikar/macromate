"""Proves Row Level Security actually isolates users, against the real live
Supabase project — not just that policies exist, but that they work: user A
cannot read/write user B's private rows through PostgREST, exactly the way
the frontend (anon key + user JWT) accesses data.
"""

import uuid

import httpx
import pytest

from app.core.config import get_settings

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url
    or not settings.supabase_service_role_key
    or not settings.supabase_anon_key,
    reason="Supabase credentials not configured",
)


def _create_and_sign_in_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-rls-test-{uuid.uuid4().hex[:12]}@example.com"
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
    token = signin_resp.json()["access_token"]
    return user_id, token, admin_headers


def _delete_user(user_id: str, admin_headers: dict):
    httpx.delete(
        f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
        headers=admin_headers,
        timeout=15,
    )


@pytest.fixture
def two_users():
    a_id, a_token, admin_headers = _create_and_sign_in_user()
    b_id, b_token, _ = _create_and_sign_in_user()
    try:
        yield {
            "a": {"id": a_id, "token": a_token},
            "b": {"id": b_id, "token": b_token},
        }
    finally:
        _delete_user(a_id, admin_headers)
        _delete_user(b_id, admin_headers)


def _rest_headers(token: str) -> dict:
    # apikey is the anon/publishable key — the same credential the frontend
    # uses. Per-request authorization comes from the user's own JWT, which
    # is what RLS's auth.uid() actually evaluates.
    return {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def test_user_can_only_see_own_weight_logs(two_users):
    a, b = two_users["a"], two_users["b"]

    insert_resp = httpx.post(
        f"{settings.supabase_url}/rest/v1/weight_logs",
        headers=_rest_headers(a["token"]),
        json={"user_id": a["id"], "weight_kg": 80},
        timeout=15,
    )
    assert insert_resp.status_code == 201, insert_resp.text

    # User A can see their own row.
    a_view = httpx.get(
        f"{settings.supabase_url}/rest/v1/weight_logs?user_id=eq.{a['id']}",
        headers=_rest_headers(a["token"]),
        timeout=15,
    )
    assert a_view.status_code == 200
    assert len(a_view.json()) == 1

    # User B querying the same row sees nothing — RLS filters it out.
    b_view = httpx.get(
        f"{settings.supabase_url}/rest/v1/weight_logs?user_id=eq.{a['id']}",
        headers=_rest_headers(b["token"]),
        timeout=15,
    )
    assert b_view.status_code == 200
    assert b_view.json() == []


def test_user_can_only_see_own_food_logs(two_users):
    a, b = two_users["a"], two_users["b"]
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }

    food_resp = httpx.post(
        f"{settings.supabase_url}/rest/v1/food_items",
        headers={**admin_headers, "Content-Type": "application/json", "Prefer": "return=representation"},
        json={
            "name": f"__test_rls_food_logs_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 unit",
            "calories": 100,
            "protein_g": 5,
            "carbs_g": 10,
            "fat_g": 2,
        },
        timeout=15,
    )
    food_id = food_resp.json()[0]["id"]

    try:
        insert_resp = httpx.post(
            f"{settings.supabase_url}/rest/v1/food_logs",
            headers=_rest_headers(a["token"]),
            json={
                "user_id": a["id"],
                "food_item_id": food_id,
                "meal_type": "lunch",
                "quantity": 1,
                "calories": 100,
                "protein_g": 5,
                "carbs_g": 10,
                "fat_g": 2,
            },
            timeout=15,
        )
        assert insert_resp.status_code == 201, insert_resp.text

        # User B cannot see A's food log via a direct table query...
        b_view = httpx.get(
            f"{settings.supabase_url}/rest/v1/food_logs?user_id=eq.{a['id']}",
            headers=_rest_headers(b["token"]),
            timeout=15,
        )
        assert b_view.status_code == 200
        assert b_view.json() == []

        # ...nor by omitting the filter and hoping RLS just narrows the
        # unfiltered result set to their own rows (B has none, so this
        # proves RLS isn't merely relying on the client's own WHERE clause).
        b_unfiltered = httpx.get(
            f"{settings.supabase_url}/rest/v1/food_logs",
            headers=_rest_headers(b["token"]),
            timeout=15,
        )
        assert b_unfiltered.status_code == 200
        assert all(row["user_id"] != a["id"] for row in b_unfiltered.json())
    finally:
        httpx.delete(
            f"{settings.supabase_url}/rest/v1/food_logs?food_item_id=eq.{food_id}",
            headers=admin_headers,
            timeout=15,
        )
        httpx.delete(
            f"{settings.supabase_url}/rest/v1/food_items?id=eq.{food_id}",
            headers=admin_headers,
            timeout=15,
        )


def test_user_can_only_see_own_chat_history(two_users):
    a, b = two_users["a"], two_users["b"]

    insert_resp = httpx.post(
        f"{settings.supabase_url}/rest/v1/chat_history",
        headers=_rest_headers(a["token"]),
        json={"user_id": a["id"], "role": "user", "content": "private coach message"},
        timeout=15,
    )
    assert insert_resp.status_code == 201, insert_resp.text

    b_view = httpx.get(
        f"{settings.supabase_url}/rest/v1/chat_history?user_id=eq.{a['id']}",
        headers=_rest_headers(b["token"]),
        timeout=15,
    )
    assert b_view.status_code == 200
    assert b_view.json() == []


def test_user_cannot_read_another_users_profile_directly(two_users):
    # profiles RLS is auth.uid() = id — strictly self-only at the table
    # level. Cross-user profile visibility (friend search, leaderboard)
    # only exists through the backend's authorized endpoints, which apply
    # their own filtering (e.g. friends-only + leaderboard_visible) before
    # using the service-role key — never through a direct client query.
    a, b = two_users["a"], two_users["b"]

    create_resp = httpx.post(
        f"{settings.supabase_url}/rest/v1/profiles",
        headers=_rest_headers(a["token"]),
        json={
            "id": a["id"],
            "username": f"rlsprofile{uuid.uuid4().hex[:8]}",
            "sex": "male",
            "age_years": 30,
            "height_cm": 175,
            "activity_level": "moderate",
            "goal": "maintain",
            "target_calories": 2000,
            "target_protein_g": 150,
            "target_carbs_g": 200,
            "target_fat_g": 60,
        },
        timeout=15,
    )
    assert create_resp.status_code == 201, create_resp.text

    # A can read their own profile.
    a_view = httpx.get(
        f"{settings.supabase_url}/rest/v1/profiles?id=eq.{a['id']}",
        headers=_rest_headers(a["token"]),
        timeout=15,
    )
    assert len(a_view.json()) == 1

    # B cannot read A's profile via a direct table query, even though the
    # row genuinely exists.
    b_view = httpx.get(
        f"{settings.supabase_url}/rest/v1/profiles?id=eq.{a['id']}",
        headers=_rest_headers(b["token"]),
        timeout=15,
    )
    assert b_view.status_code == 200
    assert b_view.json() == []


def test_user_cannot_insert_row_impersonating_another_user(two_users):
    a, b = two_users["a"], two_users["b"]

    # User B tries to insert a weight_log with user_id set to A — the
    # policy's WITH CHECK (auth.uid() = user_id) must reject this.
    resp = httpx.post(
        f"{settings.supabase_url}/rest/v1/weight_logs",
        headers=_rest_headers(b["token"]),
        json={"user_id": a["id"], "weight_kg": 999},
        timeout=15,
    )
    assert resp.status_code in (401, 403), resp.text


def test_food_items_are_globally_readable_but_only_creator_can_edit_unverified(
    two_users,
):
    a, b = two_users["a"], two_users["b"]
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }

    create_resp = httpx.post(
        f"{settings.supabase_url}/rest/v1/food_items",
        headers=_rest_headers(a["token"]),
        json={
            "name": f"__test_rls_food_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 unit",
            "calories": 100,
            "protein_g": 5,
            "carbs_g": 10,
            "fat_g": 2,
            "created_by": a["id"],
        },
        timeout=15,
    )
    assert create_resp.status_code == 201, create_resp.text
    food_id = create_resp.json()[0]["id"]

    try:
        # User B (different user) can read it — shared global database.
        b_read = httpx.get(
            f"{settings.supabase_url}/rest/v1/food_items?id=eq.{food_id}",
            headers=_rest_headers(b["token"]),
            timeout=15,
        )
        assert b_read.status_code == 200
        assert len(b_read.json()) == 1

        # User B cannot edit A's unverified entry.
        b_edit = httpx.patch(
            f"{settings.supabase_url}/rest/v1/food_items?id=eq.{food_id}",
            headers=_rest_headers(b["token"]),
            json={"calories": 9999},
            timeout=15,
        )
        assert b_edit.status_code == 200
        assert b_edit.json() == []  # matched 0 rows under RLS, silently no-ops
    finally:
        # food_items is a shared production table — never leave test rows in it.
        httpx.delete(
            f"{settings.supabase_url}/rest/v1/food_items?id=eq.{food_id}",
            headers=admin_headers,
            timeout=15,
        )

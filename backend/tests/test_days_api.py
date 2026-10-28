"""Live tests for /api/days/{date} and /api/days/summary against the TEST
Supabase project: real users, real rows, real RLS-bypassing service role."""

import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin, service_headers
from app.main import app

settings = get_settings()
TZ = "Asia/Kolkata"
IST = ZoneInfo(TZ)

pytestmark = pytest.mark.skipif(
    not settings.supabase_url or not settings.supabase_service_role_key,
    reason="Supabase credentials not configured",
)


def _local_today():
    return datetime.now(IST).date()


def _utc_at(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=IST).astimezone(timezone.utc).isoformat()


def _create_user():
    admin = service_headers(settings.supabase_service_role_key)
    email = f"macromate-days-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    created = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    assert created.status_code in (200, 201), created.text
    user_id = created.json()["id"]
    signin = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_anon_key or settings.supabase_service_role_key},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert signin.status_code == 200, signin.text
    return user_id, {"Authorization": f"Bearer {signin.json()['access_token']}"}


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
def world():
    """User A with a profile (IST), a food, logs on today-3 (including one at
    23:50 local), water, a weight, and a target history; user B with nothing."""
    db = SupabaseAdmin()
    a_id, a_headers = _create_user()
    b_id, b_headers = _create_user()
    today = _local_today()
    d3 = today - timedelta(days=3)

    db.insert(
        "profiles",
        {
            "id": a_id,
            "username": f"days_{uuid.uuid4().hex[:8]}",
            "sex": "male",
            "age_years": 30,
            "height_cm": 175,
            "activity_level": "moderate",
            "goal": "maintain",
            "target_calories": 2400,
            "target_protein_g": 150,
            "target_carbs_g": 250,
            "target_fat_g": 70,
            "water_goal_ml": 3000,
            "timezone": TZ,
        },
    )
    food = db.insert(
        "food_items",
        {
            "name": f"__daystest_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 serving",
            "calories": 500,
            "protein_g": 40,
            "carbs_g": 50,
            "fat_g": 10,
            "verified": True,
        },
    )[0]

    def log(day, hour, minute=0, meal="lunch"):
        return db.insert(
            "food_logs",
            {
                "user_id": a_id,
                "food_item_id": food["id"],
                "meal_type": meal,
                "quantity": 1,
                "calories": 500,
                "protein_g": 40,
                "carbs_g": 50,
                "fat_g": 10,
                "source": "database",
                "logged_at": _utc_at(day, hour, minute),
            },
        )[0]

    log(d3, 8, meal="breakfast")
    log(d3, 23, 50, meal="dinner")  # 18:20 UTC: same UTC date, but late in the local day
    log(today - timedelta(days=2), 0, 10, meal="snack")  # 18:40 UTC the day BEFORE
    db.insert("water_logs", {"user_id": a_id, "volume_ml": 750, "logged_at": _utc_at(d3, 10)})
    db.insert("weight_logs", {"user_id": a_id, "weight_kg": 80.5, "logged_at": _utc_at(d3, 7)})

    # Target history: 2400 kcal from today-10 (real history), 1900 from today.
    db._request(
        "DELETE", "daily_targets", params={"user_id": f"eq.{a_id}"}
    )
    db.insert(
        "daily_targets",
        {
            "user_id": a_id,
            "effective_from": (today - timedelta(days=10)).isoformat(),
            "target_calories": 2400,
            "target_protein_g": 150,
            "target_carbs_g": 250,
            "target_fat_g": 70,
            "water_goal_ml": 3000,
            "is_backfill": False,
        },
    )
    db.update(
        "profiles",
        {"id": f"eq.{a_id}"},
        {"target_calories": 1900, "target_protein_g": 160, "target_carbs_g": 180, "target_fat_g": 60},
    )  # trigger writes today's snapshot

    try:
        yield {"a": a_headers, "b": b_headers, "a_id": a_id, "today": today, "d3": d3}
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food['id']}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food['id']}"})
        _delete_user(a_id)
        _delete_user(b_id)


def test_day_with_data_matches_logs_water_weight_and_timezone(client, world):
    d3 = world["d3"].isoformat()
    resp = client.get(f"/api/days/{d3}", headers=world["a"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["date"] == d3 and body["is_today"] is False
    assert [m["meal_type"] for m in body["meals"]] == ["breakfast", "dinner"]
    assert body["consumed"]["calories"] == 1000
    assert body["water"]["total_ml"] == 750
    assert body["weight_kg"] == 80.5
    # 1000 of 2400 kcal is well below the +/-10% band.
    assert body["targets"]["calories"] == 2400
    assert body["status"]["calories"] == "low"
    assert body["timezone"] == TZ


def test_log_just_after_local_midnight_belongs_to_the_local_day(client, world):
    d2 = (world["today"] - timedelta(days=2)).isoformat()
    body = client.get(f"/api/days/{d2}", headers=world["a"]).json()
    assert [m["meal_type"] for m in body["meals"]] == ["snack"]
    # ...and not to the previous local day.
    d3 = world["d3"].isoformat()
    previous = client.get(f"/api/days/{d3}", headers=world["a"]).json()
    assert "snack" not in [m["meal_type"] for m in previous["meals"]]


def test_empty_day_is_all_zeros_not_an_error(client, world):
    empty = (world["today"] - timedelta(days=6)).isoformat()
    resp = client.get(f"/api/days/{empty}", headers=world["a"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["meals"] == [] and body["consumed"]["calories"] == 0
    assert body["water"] == {"total_ml": 0, "logs": []}
    assert body["status"]["calories"] == "none"
    assert body["weight_kg"] is None and body["activity"] is None


def test_each_day_shows_the_targets_that_were_active_then(client, world):
    old = client.get(f"/api/days/{(world['today'] - timedelta(days=5)).isoformat()}", headers=world["a"]).json()
    now = client.get(f"/api/days/{world['today'].isoformat()}", headers=world["a"]).json()
    assert old["targets"]["calories"] == 2400 and old["targets"]["is_approximate"] is False
    assert now["targets"]["calories"] == 1900
    assert now["targets"]["protein_g"] == 160 and now["is_today"] is True


def test_invalid_and_future_dates_are_rejected(client, world):
    assert client.get("/api/days/2026-13-45", headers=world["a"]).status_code == 422
    assert client.get("/api/days/banana", headers=world["a"]).status_code == 422
    future = (world["today"] + timedelta(days=1)).isoformat()
    assert client.get(f"/api/days/{future}", headers=world["a"]).status_code == 422


def test_summary_returns_one_entry_per_day_with_statuses(client, world):
    start = (world["today"] - timedelta(days=6)).isoformat()
    end = world["today"].isoformat()
    resp = client.get(f"/api/days/summary?start={start}&end={end}", headers=world["a"])
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 7 and rows[0]["date"] == start and rows[-1]["date"] == end
    by_date = {r["date"]: r for r in rows}
    d3 = by_date[world["d3"].isoformat()]
    assert d3["logged"] is True and d3["calories"] == 1000 and d3["water_ml"] == 750
    assert by_date[(world["today"] - timedelta(days=6)).isoformat()]["logged"] is False


def test_summary_validates_range(client, world):
    today = world["today"]
    too_long = (today - timedelta(days=100)).isoformat()
    assert client.get(f"/api/days/summary?start={too_long}&end={today.isoformat()}", headers=world["a"]).status_code == 422
    assert client.get(f"/api/days/summary?start={today.isoformat()}&end={(today - timedelta(days=1)).isoformat()}", headers=world["a"]).status_code == 422
    future_end = (today + timedelta(days=2)).isoformat()
    assert client.get(f"/api/days/summary?start={today.isoformat()}&end={future_end}", headers=world["a"]).status_code == 422


def test_requires_authentication_and_never_leaks_between_users(client, world):
    d3 = world["d3"].isoformat()
    assert client.get(f"/api/days/{d3}").status_code == 401
    assert client.get(f"/api/days/summary?start={d3}&end={d3}").status_code == 401
    # User B has no profile yet -> told to onboard, never shown A's data.
    assert client.get(f"/api/days/{d3}", headers=world["b"]).status_code == 404


def test_backfilling_food_and_water_lands_on_the_chosen_day_only(client, world):
    db = SupabaseAdmin()
    food = db.insert(
        "food_items",
        {
            "name": f"__backfill_{uuid.uuid4().hex[:8]}",
            "serving_description": "1 serving",
            "calories": 200,
            "protein_g": 10,
            "carbs_g": 20,
            "fat_g": 5,
            "verified": True,
        },
    )[0]
    try:
        target = (world["today"] - timedelta(days=5)).isoformat()
        logged = client.post(
            "/api/food-logs",
            headers=world["a"],
            json={"food_item_id": food["id"], "meal_type": "snack", "quantity": 2, "log_date": target},
        )
        assert logged.status_code == 200, logged.text
        water = client.post(
            "/api/water-logs", headers=world["a"], json={"volume_ml": 500, "log_date": target}
        )
        assert water.status_code == 200, water.text

        day = client.get(f"/api/days/{target}", headers=world["a"]).json()
        assert day["consumed"]["calories"] == 400
        assert day["water"]["total_ml"] == 500
        today = client.get(f"/api/days/{world['today'].isoformat()}", headers=world["a"]).json()
        assert today["consumed"]["calories"] == 0  # nothing leaked onto today

        # Edit and delete work on past days too (by id, no date restriction).
        patched = client.patch(
            f"/api/food-logs/{logged.json()['id']}", headers=world["a"], json={"meal_type": "dinner"}
        )
        assert patched.status_code == 200 and patched.json()["meal_type"] == "dinner"

        # Undo one container on the past day.
        removed = client.post(
            "/api/water-logs/remove", headers=world["a"], json={"volume_ml": 500, "log_date": target}
        )
        assert removed.status_code == 200 and removed.json()["total_ml"] == 0

        assert client.delete(f"/api/food-logs/{logged.json()['id']}", headers=world["a"]).status_code == 204
    finally:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{food['id']}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food['id']}"})


def test_backfill_rejects_future_dates(client, world):
    future = (world["today"] + timedelta(days=1)).isoformat()
    water = client.post(
        "/api/water-logs", headers=world["a"], json={"volume_ml": 250, "log_date": future}
    )
    assert water.status_code == 422

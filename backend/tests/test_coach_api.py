"""End-to-end tests for /api/ai/coach/* against the real database and,
for the open-ended question, the real Gemini API.

Most of the action/domain-restriction coverage below stubs Gemini
(`generate_text`) with a canned structured-intent JSON response and
exercises the real deterministic dispatch/action-execution/database path in
app/routers/coach.py + app/domain/coach_actions.py -- the actual
authoritative behavior -- without burning live Gemini quota on every run."""

import json
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
def onboarded_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-coach-test-{uuid.uuid4().hex[:10]}@example.com"
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
            "username": f"coachtest{uuid.uuid4().hex[:6]}",
            "sex": "male",
            "age_years": 28,
            "height_cm": 178,
            "activity_level": "moderate",
            "goal": "maintain",
            "target_calories": 2200,
            "target_protein_g": 160,
            "target_carbs_g": 220,
            "target_fat_g": 70,
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


def _create_onboarded_user():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-coach-test-{uuid.uuid4().hex[:10]}@example.com"
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
            "username": f"coachtest{uuid.uuid4().hex[:6]}",
            "sex": "male",
            "age_years": 28,
            "height_cm": 178,
            "activity_level": "moderate",
            "goal": "maintain",
            "target_calories": 2200,
            "target_protein_g": 160,
            "target_carbs_g": 220,
            "target_fat_g": 70,
        },
    )
    signin_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_service_role_key},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert signin_resp.status_code == 200
    headers = {"Authorization": f"Bearer {signin_resp.json()['access_token']}"}
    return user_id, headers


def _delete_ai_estimate_food_items_for_user(db: SupabaseAdmin, user_id: str) -> None:
    """The Coach's add-food action (execute_add_food -> get_or_create_personal_food)
    can create a new food_items row scoped to this user that the test never
    explicitly tracks. food_items.created_by is ON DELETE SET NULL, so simply
    deleting the auth user orphans these rows forever instead of removing
    them -- they then sit in the real database and can leak into other
    users' smart-food-suggestions results. Must run *before* the user is
    deleted, while created_by is still set."""
    rows = db.select(
        "food_items", {"created_by": f"eq.{user_id}", "is_ai_estimate": "eq.true", "select": "id"}
    )
    for row in rows:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{row['id']}"})
    for row in rows:
        db._request("DELETE", "food_items", params={"id": f"eq.{row['id']}"})


@pytest.fixture
def onboarded_user_full():
    """Same seeded user as `onboarded_user`, but also exposes the raw
    user_id so tests can query food_logs/water_logs directly to verify a
    Coach action actually persisted (or didn't)."""
    user_id, headers = _create_onboarded_user()
    try:
        yield user_id, headers
    finally:
        _delete_ai_estimate_food_items_for_user(SupabaseAdmin(), user_id)
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=15,
        )


def _stub_gemini_intent(monkeypatch, payload: dict):
    calls = {"count": 0}

    def fake_generate_text(prompt, *, system_instruction=None, timeout=20):
        calls["count"] += 1
        return json.dumps(payload)

    monkeypatch.setattr("app.routers.coach.generate_text", fake_generate_text)
    return calls


def test_fast_path_question_answers_deterministically_and_persists(
    client, onboarded_user
):
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "How much protein do I have left?"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "160g" in body["content"]  # no food logged yet -> full target remaining

    history = client.get("/api/ai/coach/history", headers=onboarded_user)
    assert history.status_code == 200
    roles = [m["role"] for m in history.json()]
    assert roles == ["user", "assistant"]


@pytest.mark.skipif(not settings.gemini_api_key, reason="GEMINI_API_KEY not configured")
def test_open_ended_question_uses_gemini_with_injected_context(client, onboarded_user):
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "Give me one quick tip to hit my protein goal today."},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["content"]) > 0

    history = client.get("/api/ai/coach/history", headers=onboarded_user).json()
    assert len(history) == 2


# ---------------------------------------------------------------------------
# Stubbed-Gemini coverage: domain restriction, nutrition Q&A, and actions.
# ---------------------------------------------------------------------------


def test_coach_answers_a_nutrition_question_without_logging_anything(
    client, onboarded_user_full, monkeypatch
):
    user_id, headers = onboarded_user_full
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": True,
            "intent": "read",
            "nutrition_estimate": [
                {
                    "food_name": "Paneer",
                    "amount": 200,
                    "unit": "g",
                    "calories": 550,
                    "protein_g": 36,
                    "carbs_g": 8,
                    "fat_g": 42,
                    "assumption": "Varies by brand.",
                }
            ],
            "reply": "About 550 kcal for 200g paneer -- roughly 36g protein, 8g carbs, 42g fat.",
        },
    )

    resp = client.post(
        "/api/ai/coach/message",
        headers=headers,
        json={"message": "How many calories are in 200g paneer?"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "550" in body["content"]
    assert body["action"] is None

    db = SupabaseAdmin()
    logs = db.select("food_logs", {"user_id": f"eq.{user_id}"})
    assert logs == []
    # A read-only nutrition question must not create a reusable personal
    # food either -- only an explicit add-food action may.
    items = db.select("food_items", {"created_by": f"eq.{user_id}"})
    assert items == []


def test_coach_answers_a_fitness_question_in_scope(client, onboarded_user, monkeypatch):
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": True,
            "intent": "read",
            "reply": "For a cut, aim for roughly 1.6-2.2g of protein per kg of bodyweight.",
        },
    )
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "How much protein should I eat during my cut?"},
    )
    assert resp.status_code == 200, resp.text
    assert "protein" in resp.json()["content"].lower()


def test_coach_answers_a_health_wellness_question_briefly_and_safely(
    client, onboarded_user, monkeypatch
):
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": True,
            "intent": "read",
            "reply": "Persistent chest pain isn't something to wait out -- please see a doctor or seek urgent care.",
        },
    )
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "I've had chest pain during workouts for days, what should I do?"},
    )
    assert resp.status_code == 200, resp.text
    content = resp.json()["content"].lower()
    assert "doctor" in content or "medical" in content


def test_coach_add_food_action_logs_multiple_foods_to_the_requested_meal(
    client, onboarded_user_full, monkeypatch
):
    user_id, headers = onboarded_user_full
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": True,
            "intent": "add_food",
            "meal_type": "lunch",
            "foods": [
                {
                    "raw_phrase": "200g paneer", "search_name": f"__coachapi_paneer_{uuid.uuid4().hex[:8]}",
                    "amount": 200, "unit": "g",
                    "estimated_calories": 550, "estimated_protein_g": 36,
                    "estimated_carbs_g": 8, "estimated_fat_g": 42, "assumption": "",
                },
                {
                    "raw_phrase": "2 rotis", "search_name": f"__coachapi_roti_{uuid.uuid4().hex[:8]}",
                    "amount": 2, "unit": "serving",
                    "estimated_calories": 240, "estimated_protein_g": 6,
                    "estimated_carbs_g": 40, "estimated_fat_g": 6, "assumption": "",
                },
            ],
            "reply": "",
        },
    )

    resp = client.post(
        "/api/ai/coach/message",
        headers=headers,
        json={"message": "Add 200g paneer with 2 rotis to lunch."},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["action"] == "add_food"
    assert "Lunch" in body["content"]
    assert str(round(550 + 240)) in body["content"] or "790" in body["content"]

    db = SupabaseAdmin()
    logs = db.select("food_logs", {"user_id": f"eq.{user_id}"})
    assert len(logs) == 2
    assert all(log["meal_type"] == "lunch" for log in logs)
    assert all(log["source"] == "ai_estimate" for log in logs)


def test_coach_add_food_respects_a_different_requested_meal(
    client, onboarded_user_full, monkeypatch
):
    user_id, headers = onboarded_user_full
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": True,
            "intent": "add_food",
            "meal_type": "breakfast",
            "foods": [
                {
                    "raw_phrase": "3 eggs", "search_name": f"__coachapi_egg_{uuid.uuid4().hex[:8]}",
                    "amount": 3, "unit": "serving",
                    "estimated_calories": 210, "estimated_protein_g": 18,
                    "estimated_carbs_g": 1, "estimated_fat_g": 15, "assumption": "",
                }
            ],
            "reply": "",
        },
    )
    resp = client.post(
        "/api/ai/coach/message",
        headers=headers,
        json={"message": "Add 3 eggs to breakfast."},
    )
    assert resp.status_code == 200, resp.text
    assert "Breakfast" in resp.json()["content"]

    db = SupabaseAdmin()
    logs = db.select("food_logs", {"user_id": f"eq.{user_id}"})
    assert len(logs) == 1
    assert logs[0]["meal_type"] == "breakfast"


def test_coach_asks_for_clarification_instead_of_guessing_a_missing_quantity(
    client, onboarded_user_full, monkeypatch
):
    user_id, headers = onboarded_user_full
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": True,
            "intent": "add_food",
            "needs_clarification": True,
            "clarification_question": "How much chicken would you like to add?",
            "reply": "",
        },
    )
    resp = client.post(
        "/api/ai/coach/message", headers=headers, json={"message": "Add some chicken"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "how much" in body["content"].lower()
    assert body["action"] is None

    db = SupabaseAdmin()
    assert db.select("food_logs", {"user_id": f"eq.{user_id}"}) == []


def test_coach_does_not_claim_success_when_no_food_could_be_added(
    client, onboarded_user_full, monkeypatch
):
    """add_food with an empty foods list -- e.g. Gemini couldn't identify
    anything concrete -- must never claim an action happened."""
    user_id, headers = onboarded_user_full
    _stub_gemini_intent(
        monkeypatch,
        {"in_scope": True, "intent": "add_food", "foods": [], "reply": ""},
    )
    resp = client.post(
        "/api/ai/coach/message", headers=headers, json={"message": "add that thing"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "add" not in body["content"].lower() or "couldn't" in body["content"].lower()
    assert body["action"] is None

    db = SupabaseAdmin()
    assert db.select("food_logs", {"user_id": f"eq.{user_id}"}) == []


def test_coach_log_water_action_persists_and_confirms(client, onboarded_user_full, monkeypatch):
    user_id, headers = onboarded_user_full
    _stub_gemini_intent(
        monkeypatch,
        {"in_scope": True, "intent": "log_water", "water_ml": 2000, "reply": ""},
    )
    resp = client.post(
        "/api/ai/coach/message", headers=headers, json={"message": "Log 2 liters of water"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["action"] == "log_water"
    assert "2000" in body["content"] or "2,000" in body["content"]

    db = SupabaseAdmin()
    logs = db.select("water_logs", {"user_id": f"eq.{user_id}"})
    assert len(logs) == 1
    assert logs[0]["volume_ml"] == 2000


def test_coach_remove_food_action_removes_an_unambiguous_match(
    client, onboarded_user_full, monkeypatch
):
    user_id, headers = onboarded_user_full
    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    name = f"__coachapi_removeme_{suffix}"
    food_id = db.insert(
        "food_items",
        {"name": name, "serving_description": "1 bowl", "calories": 200, "protein_g": 10, "carbs_g": 20, "fat_g": 5},
    )[0]["id"]
    db.insert(
        "food_logs",
        {
            "user_id": user_id, "food_item_id": food_id, "meal_type": "lunch", "quantity": 1,
            "calories": 200, "protein_g": 10, "carbs_g": 20, "fat_g": 5,
        },
    )
    try:
        _stub_gemini_intent(
            monkeypatch,
            {
                "in_scope": True,
                "intent": "remove_food",
                "remove_description": name.replace("__coachapi_", ""),
                "reply": "",
            },
        )
        resp = client.post(
            "/api/ai/coach/message", headers=headers, json={"message": "Remove the paneer I just added"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["action"] == "remove_food"
        assert len(db.select("food_logs", {"user_id": f"eq.{user_id}"})) == 0
    finally:
        db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_coach_refuses_a_programming_request_without_answering_it(
    client, onboarded_user, monkeypatch
):
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": False,
            "intent": "read",
            # Even if the model tried to answer anyway, the backend must
            # ignore this and use its own fixed refusal.
            "reply": "def add(a, b):\n    return a + b",
        },
    )
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "Write Python code to add two numbers."},
    )
    assert resp.status_code == 200, resp.text
    content = resp.json()["content"]
    assert "def add" not in content
    assert "return a + b" not in content
    assert "fitness" in content.lower() or "nutrition" in content.lower()


def test_coach_refuses_an_unrelated_general_knowledge_request(
    client, onboarded_user, monkeypatch
):
    _stub_gemini_intent(
        monkeypatch,
        {"in_scope": False, "intent": "read", "reply": "Quantum physics is the study of..."},
    )
    resp = client.post(
        "/api/ai/coach/message",
        headers=onboarded_user,
        json={"message": "Tell me about quantum physics."},
    )
    assert resp.status_code == 200, resp.text
    content = resp.json()["content"]
    assert "quantum" not in content.lower()
    assert "fitness" in content.lower() or "nutrition" in content.lower()


def test_coach_add_food_reply_does_not_expose_internal_ids(
    client, onboarded_user_full, monkeypatch
):
    user_id, headers = onboarded_user_full
    _stub_gemini_intent(
        monkeypatch,
        {
            "in_scope": True,
            "intent": "add_food",
            "meal_type": "snack",
            "foods": [
                {
                    "raw_phrase": "1 banana", "search_name": f"__coachapi_banana_{uuid.uuid4().hex[:8]}",
                    "amount": 1, "unit": "serving",
                    "estimated_calories": 105, "estimated_protein_g": 1,
                    "estimated_carbs_g": 27, "estimated_fat_g": 0, "assumption": "",
                }
            ],
            "reply": "",
        },
    )
    resp = client.post(
        "/api/ai/coach/message", headers=headers, json={"message": "Add a banana to snacks"}
    )
    assert resp.status_code == 200, resp.text
    content = resp.json()["content"]
    # No UUID-shaped internal id anywhere in the user-facing text.
    import re

    assert not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", content)


def test_coach_action_only_affects_the_authenticated_users_own_data(
    client, onboarded_user_full, monkeypatch
):
    user_id, headers = onboarded_user_full
    other_user_id, other_headers = _create_onboarded_user()
    try:
        _stub_gemini_intent(
            monkeypatch,
            {"in_scope": True, "intent": "log_water", "water_ml": 500, "reply": ""},
        )
        resp = client.post(
            "/api/ai/coach/message", headers=headers, json={"message": "log 500ml of water"}
        )
        assert resp.status_code == 200, resp.text

        db = SupabaseAdmin()
        assert len(db.select("water_logs", {"user_id": f"eq.{user_id}"})) == 1
        assert db.select("water_logs", {"user_id": f"eq.{other_user_id}"}) == []
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{other_user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=15,
        )

"""Tests for POST /api/ai/calculate-foods.

Most tests here stub Gemini (`generate_text`) with a canned JSON response
and exercise the real Supabase-backed matching/ambiguity/estimate-fallback
logic in app/domain/food_resolution.py -- this is the actual authoritative
behavior (Gemini only splits text, reports a literal amount+unit, and gives
its own nutrition estimate; the backend decides database-vs-estimate and
does all unit-conversion/nutrition arithmetic), and stubbing keeps the
suite from burning live Gemini quota on every run. One smoke test at the
bottom still calls the real Gemini API, skipped automatically when no key
is configured, to catch drift in the live integration.
"""

import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.gemini import GeminiUnavailable
from app.core.supabase_admin import SupabaseAdmin
from app.main import app

settings = get_settings()

requires_supabase = pytest.mark.skipif(
    not settings.supabase_url or not settings.supabase_service_role_key,
    reason="Supabase credentials not configured",
)
requires_gemini = pytest.mark.skipif(
    not settings.gemini_api_key,
    reason="Gemini credentials not configured",
)


@pytest.fixture
def auth_headers():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-aifood-test-{uuid.uuid4().hex[:10]}@example.com"
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


class _SeededFoods:
    """Seeds distinctly-named food_items rows and tracks them for cleanup.
    Names carry a random suffix so trigram search against the real,
    shared, product-connected food_items table can't accidentally collide
    with a real food."""

    def __init__(self):
        self.db = SupabaseAdmin()
        self.ids: list[str] = []

    def add(self, name: str, serving_description: str, **macros) -> str:
        row = self.db.insert(
            "food_items",
            {
                "name": name,
                "serving_description": serving_description,
                "calories": macros.get("calories", 200),
                "protein_g": macros.get("protein_g", 10),
                "carbs_g": macros.get("carbs_g", 20),
                "fat_g": macros.get("fat_g", 5),
            },
        )[0]
        self.ids.append(row["id"])
        return row["id"]

    def cleanup(self):
        for food_id in self.ids:
            self.db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


@pytest.fixture
def seeded():
    foods = _SeededFoods()
    try:
        yield foods
    finally:
        foods.cleanup()


def _item(raw_phrase, search_name, amount, unit, **overrides) -> dict:
    """A parsed-item stub with sensible default AI-estimate fields, so each
    test only has to override what it's actually testing."""
    base = {
        "raw_phrase": raw_phrase,
        "search_name": search_name,
        "amount": amount,
        "unit": unit,
        "estimated_calories": 300,
        "estimated_protein_g": 20,
        "estimated_carbs_g": 15,
        "estimated_fat_g": 12,
        "assumption": "",
    }
    base.update(overrides)
    return base


def _stub_gemini(monkeypatch, items: list[dict]):
    """Replaces the router's Gemini call with a canned JSON array response,
    and returns a call counter so tests can assert Gemini was called at
    most once per request regardless of how many foods were parsed."""
    calls = {"count": 0}

    def fake_generate_text(prompt, *, system_instruction=None, timeout=20):
        calls["count"] += 1
        return json.dumps(items)

    monkeypatch.setattr("app.routers.ai_food.generate_text", fake_generate_text)
    return calls


@requires_supabase
def test_gram_amount_converts_deterministically_using_the_matched_foods_real_serving_weight(
    client, auth_headers, seeded, monkeypatch
):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_paneer_{suffix}"
    seeded.add(name, "100g", calories=265, protein_g=18, carbs_g=6, fat_g=20)
    _stub_gemini(monkeypatch, [_item("250g paneer", name, 250, "g")])

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
    assert resp.status_code == 200, resp.text
    item = resp.json()["items"][0]

    assert item["resolved"] is True
    assert item["ambiguous"] is False
    assert item["source"] == "database"
    assert item["quantity_is_assumption"] is False
    # 250g against a real 100g serving -> exactly 2.5 servings, not Gemini's
    # own guess -- deterministic arithmetic against the matched food's real
    # serving metadata, database nutrition preferred over the estimate.
    assert item["quantity"] == pytest.approx(2.5)
    assert item["calories"] == pytest.approx(265 * 2.5, abs=0.5)


@requires_supabase
def test_ml_amount_converts_using_real_serving_volume(client, auth_headers, seeded, monkeypatch):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_milk_{suffix}"
    seeded.add(name, "250ml", calories=120, protein_g=6, carbs_g=9, fat_g=6)
    _stub_gemini(monkeypatch, [_item("500ml milk", name, 500, "ml")])

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
    item = resp.json()["items"][0]

    assert item["resolved"] is True
    assert item["source"] == "database"
    assert item["quantity"] == pytest.approx(2.0)
    assert item["quantity_is_assumption"] is False


@requires_supabase
def test_serving_unit_uses_the_literal_count_directly(client, auth_headers, seeded, monkeypatch):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_egg_{suffix}"
    seeded.add(name, "1 piece", calories=70, protein_g=6, carbs_g=1, fat_g=5)
    _stub_gemini(monkeypatch, [_item("3 eggs", name, 3, "serving")])

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
    item = resp.json()["items"][0]

    assert item["resolved"] is True
    assert item["source"] == "database"
    assert item["quantity"] == pytest.approx(3.0)
    assert item["quantity_is_assumption"] is False
    assert item["calories"] == pytest.approx(70 * 3, abs=0.5)


@requires_supabase
def test_weight_amount_against_a_food_with_no_known_serving_weight_is_flagged_as_an_assumption(
    client, auth_headers, seeded, monkeypatch
):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_dal_{suffix}"
    # No explicit weight in the serving description -> parse_serving_weight
    # returns None -- the app must not invent a gram-per-serving ratio.
    seeded.add(name, "1 bowl", calories=180, protein_g=9, carbs_g=25, fat_g=4)
    _stub_gemini(monkeypatch, [_item("200g dal", name, 200, "g")])

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
    item = resp.json()["items"][0]

    assert item["resolved"] is True
    assert item["source"] == "database"
    assert item["quantity_is_assumption"] is True
    # Falls back to exactly one default serving -- never a fabricated
    # gram-based ratio -- and the user is expected to correct it.
    assert item["quantity"] == pytest.approx(1.0)


@requires_supabase
def test_two_equally_similar_matches_are_surfaced_as_ambiguous_with_an_estimate_fallback(
    client, auth_headers, seeded, monkeypatch
):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_amb_{suffix}"
    # Two foods sharing the exact same name -> tied similarity -> the top
    # match is not a clear enough winner to auto-select.
    seeded.add(name, "1 bowl (150g)", calories=150, protein_g=5, carbs_g=20, fat_g=4)
    seeded.add(name, "1 cup (200g)", calories=210, protein_g=7, carbs_g=28, fat_g=6)
    _stub_gemini(
        monkeypatch,
        [_item("paneer curry", name, 1, "serving", estimated_calories=400)],
    )

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
    item = resp.json()["items"][0]

    assert item["resolved"] is False
    assert item["ambiguous"] is True
    assert item["source"] is None
    assert item["calories"] is None
    assert len(item["candidates"]) >= 2
    assert {c["food_name"] for c in item["candidates"]} == {name}
    # Ambiguity must never block completion -- a labeled estimate is
    # offered as a way to proceed without forcing a database choice.
    assert item["estimate"] is not None
    assert item["estimate"]["calories"] == 400


@requires_supabase
def test_no_database_match_falls_back_to_ai_estimate_not_a_dead_end(
    client, auth_headers, monkeypatch
):
    """DATABASE NOT FOUND must not mean AI CALCULATION FAILED: an item with
    no plausible database match still resolves, using Gemini's own
    estimate for the exact stated amount, clearly marked as an estimate."""
    unique = uuid.uuid4().hex
    _stub_gemini(
        monkeypatch,
        [
            _item(
                "200g of a fictional zorbnak fruit",
                f"zorbnak{unique}",
                200,
                "g",
                estimated_calories=180,
                estimated_protein_g=2,
                estimated_carbs_g=40,
                estimated_fat_g=1,
                assumption="Values vary by ripeness.",
            )
        ],
    )

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    item = body["items"][0]

    assert item["resolved"] is True
    assert item["ambiguous"] is False
    assert item["source"] == "ai_estimate"
    # Never a fabricated database ID.
    assert item["food_item_id"] is None
    # The estimate is for the exact stated amount directly (200g), not a
    # rescaled reference serving -- quantity mirrors the literal amount.
    assert item["quantity"] == pytest.approx(200)
    assert item["calories"] == pytest.approx(180)
    assert item["protein_g"] == pytest.approx(2)
    assert item["assumption"] == "Values vary by ripeness."
    assert body["total"]["calories"] == pytest.approx(180)


@requires_supabase
def test_multiple_items_use_exactly_one_gemini_call_and_each_resolves_independently(
    client, auth_headers, seeded, monkeypatch
):
    suffix = uuid.uuid4().hex[:10]
    paneer = f"__aitest_paneer_{suffix}"
    roti = f"__aitest_roti_{suffix}"
    seeded.add(paneer, "100g", calories=265, protein_g=18, carbs_g=6, fat_g=20)
    seeded.add(roti, "1 piece", calories=120, protein_g=3, carbs_g=20, fat_g=3)
    calls = _stub_gemini(
        monkeypatch,
        [
            _item("200g paneer", paneer, 200, "g"),
            _item("2 rotis", roti, 2, "serving"),
        ],
    )

    resp = client.post(
        "/api/ai/calculate-foods", headers=auth_headers, json={"text": "200g paneer, 2 rotis"}
    )
    body = resp.json()

    # One Gemini call total -- never once per parsed food item.
    assert calls["count"] == 1
    assert len(body["items"]) == 2
    assert all(item["resolved"] for item in body["items"])
    assert all(item["source"] == "database" for item in body["items"])
    expected_total_kcal = 265 * 2.0 + 120 * 2
    assert body["total"]["calories"] == pytest.approx(expected_total_kcal, abs=0.5)


@requires_supabase
def test_gemini_unavailable_returns_a_graceful_error_not_a_stack_trace(
    client, auth_headers, monkeypatch
):
    def raise_unavailable(prompt, *, system_instruction=None, timeout=20):
        raise GeminiUnavailable("both models down")

    monkeypatch.setattr("app.routers.ai_food.generate_text", raise_unavailable)

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "eggs"})
    assert resp.status_code == 503
    assert "Traceback" not in resp.text
    assert "temporarily unavailable" in resp.json()["detail"]


@requires_supabase
def test_malformed_gemini_response_returns_a_graceful_error(client, auth_headers, monkeypatch):
    def fake_generate_text(prompt, *, system_instruction=None, timeout=20):
        return "not json at all"

    monkeypatch.setattr("app.routers.ai_food.generate_text", fake_generate_text)

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "eggs"})
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


@requires_supabase
def test_incomplete_estimate_fields_are_a_graceful_error_not_a_crash(
    client, auth_headers, monkeypatch
):
    """Gemini omitting a required estimate field is malformed output, not a
    reason to crash or silently invent the missing number."""

    def fake_generate_text(prompt, *, system_instruction=None, timeout=20):
        return json.dumps(
            [{"raw_phrase": "eggs", "search_name": "eggs", "amount": 2, "unit": "serving"}]
        )

    monkeypatch.setattr("app.routers.ai_food.generate_text", fake_generate_text)

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "eggs"})
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


@requires_supabase
def test_empty_input_is_rejected_before_any_gemini_call(client, auth_headers, monkeypatch):
    calls = _stub_gemini(monkeypatch, [])
    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": ""})
    assert resp.status_code == 422
    assert calls["count"] == 0


# ---------------------------------------------------------------------------
# Accepted AI estimates become reusable personal foods (Phase 3 correction):
# calculating alone must persist nothing; only an explicit accept
# (POST /api/food-logs with an ai_estimate payload, exactly what "Add to
# diary" sends) may create a food_items row and a log, and that food must
# then be reusable by the same user without a fresh Gemini call while
# staying invisible to every other user.
# ---------------------------------------------------------------------------


@pytest.fixture
def second_auth_headers():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-aifood-test2-{uuid.uuid4().hex[:10]}@example.com"
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
        assert signin_resp.status_code == 200
        yield {"Authorization": f"Bearer {signin_resp.json()['access_token']}"}
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            timeout=15,
        )


def _food_items_matching(db: SupabaseAdmin, unique: str) -> list[dict]:
    return db.select("food_items", {"name": f"ilike.*{unique}*", "select": "*"})


def _cleanup_food_items(db: SupabaseAdmin, unique: str) -> None:
    """food_logs.food_item_id has ON DELETE RESTRICT, so any log created
    against one of these test food_items rows must be deleted first."""
    rows = _food_items_matching(db, unique)
    for row in rows:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{row['id']}"})
    for row in rows:
        db._request("DELETE", "food_items", params={"id": f"eq.{row['id']}"})


@requires_supabase
def test_asking_a_nutrition_question_alone_creates_no_food_item_or_log(
    client, auth_headers, monkeypatch
):
    """A calculate-foods call is read-only: it must never persist a
    food_items row or a food_log just because the user asked a question,
    even though the response already carries a full structured estimate."""
    unique = uuid.uuid4().hex
    name = f"zorbnak{unique}"
    _stub_gemini(monkeypatch, [_item(f"200g {name}", name, 200, "g", estimated_calories=180)])
    db = SupabaseAdmin()

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"][0]["source"] == "ai_estimate"

    assert _food_items_matching(db, unique) == []


@requires_supabase
def test_accepting_an_ai_estimate_creates_a_reusable_personal_food_and_a_log(
    client, auth_headers
):
    """Exactly what the Calculator's "Add to diary" (and a Coach add-food
    command) send: an explicit accept with the reviewed nutrition. This
    must create one food_items row (personal, is_ai_estimate=true) and one
    food_log with source="ai_estimate" -- and logging the *same* estimate
    again must reuse that row rather than creating a second one."""
    db = SupabaseAdmin()
    unique = uuid.uuid4().hex
    name = f"Zorbnak {unique}"
    payload = {
        "ai_estimate": {
            "name": name,
            "serving_description": "1 g",
            "calories": 0.9,
            "protein_g": 0.01,
            "carbs_g": 0.2,
            "fat_g": 0.005,
        },
        "meal_type": "lunch",
        "quantity": 200,
    }
    try:
        resp1 = client.post("/api/food-logs", headers=auth_headers, json=payload)
        assert resp1.status_code == 200, resp1.text
        log1 = resp1.json()
        assert log1["source"] == "ai_estimate"
        assert log1["calories"] == pytest.approx(180, abs=0.5)

        rows = _food_items_matching(db, unique)
        assert len(rows) == 1
        assert rows[0]["is_ai_estimate"] is True
        food_item_id = rows[0]["id"]

        # Logging the identical estimate again (e.g. a second "add 200g
        # paneer" later) reuses the same personal food -- no duplicate row.
        resp2 = client.post("/api/food-logs", headers=auth_headers, json=payload)
        assert resp2.status_code == 200, resp2.text
        log2 = resp2.json()
        assert log2["food_item_id"] == food_item_id
        assert log2["source"] == "ai_estimate"
        assert len(_food_items_matching(db, unique)) == 1
    finally:
        _cleanup_food_items(db, unique)


@requires_supabase
def test_accepted_ai_estimate_is_found_again_via_search_and_reused_without_gemini(
    client, auth_headers, monkeypatch
):
    """After being accepted once, the same food should resolve deterministically
    from the personal food_items row on a later calculation -- Gemini's role
    is only to split/re-estimate the text; the app must prefer the user's
    own already-accepted nutrition over inventing a fresh estimate."""
    db = SupabaseAdmin()
    unique = uuid.uuid4().hex
    name = f"Zorbnak {unique}"
    accept_payload = {
        "ai_estimate": {
            "name": name,
            "serving_description": "1 g",
            "calories": 0.9,
            "protein_g": 0.01,
            "carbs_g": 0.2,
            "fat_g": 0.005,
        },
        "meal_type": "lunch",
        "quantity": 200,
    }
    try:
        accept_resp = client.post("/api/food-logs", headers=auth_headers, json=accept_payload)
        assert accept_resp.status_code == 200, accept_resp.text
        food_item_id = accept_resp.json()["food_item_id"]

        found = client.get(
            "/api/foods/search", headers=auth_headers, params={"q": f"zorbnak{unique}"}
        )
        assert found.status_code == 200, found.text
        results = found.json()["results"]
        assert any(r["id"] == food_item_id and r["is_ai_estimate"] is True for r in results)

        # A fresh calculate-foods call for the exact same food now resolves
        # against that personal food deterministically (Gemini is still
        # called once to split/estimate the text, but the resolution must
        # not fabricate a second, different personal food).
        _stub_gemini(
            monkeypatch,
            [_item(f"150g {name}", name, 150, "g", estimated_calories=999)],
        )
        resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": "x"})
        assert resp.status_code == 200, resp.text
        item = resp.json()["items"][0]
        assert item["source"] == "ai_estimate"
        assert item["food_item_id"] == food_item_id
        # Uses the previously-accepted per-gram nutrition (0.9 kcal/g * 150),
        # not Gemini's fresh (and here deliberately wrong) 999 estimate.
        assert item["calories"] == pytest.approx(0.9 * 150, abs=0.5)

        assert len(_food_items_matching(db, unique)) == 1
    finally:
        _cleanup_food_items(db, unique)


@requires_supabase
def test_ai_estimated_food_is_personal_and_invisible_to_another_user(
    client, auth_headers, second_auth_headers
):
    db = SupabaseAdmin()
    unique = uuid.uuid4().hex
    name = f"Zorbnak {unique}"
    payload = {
        "ai_estimate": {
            "name": name,
            "serving_description": "1 g",
            "calories": 0.9,
            "protein_g": 0.01,
            "carbs_g": 0.2,
            "fat_g": 0.005,
        },
        "meal_type": "lunch",
        "quantity": 200,
    }
    try:
        resp = client.post("/api/food-logs", headers=auth_headers, json=payload)
        assert resp.status_code == 200, resp.text

        own_search = client.get(
            "/api/foods/search", headers=auth_headers, params={"q": f"zorbnak{unique}"}
        )
        assert any(r["name"] == name for r in own_search.json()["results"])

        other_search = client.get(
            "/api/foods/search", headers=second_auth_headers, params={"q": f"zorbnak{unique}"}
        )
        assert other_search.json()["results"] == []
    finally:
        _cleanup_food_items(db, unique)


@requires_supabase
def test_existing_verified_database_food_search_and_logging_unaffected(
    client, auth_headers, seeded
):
    """The reuse/personal-scoping correction must not change ordinary
    database-food behavior at all."""
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_dbcheck_{suffix}"
    food_id = seeded.add(name, "100g", calories=265, protein_g=18, carbs_g=6, fat_g=20)

    found = client.get("/api/foods/search", headers=auth_headers, params={"q": name})
    assert any(r["id"] == food_id and r["is_ai_estimate"] is False for r in found.json()["results"])

    log_resp = client.post(
        "/api/food-logs",
        headers=auth_headers,
        json={"food_item_id": food_id, "meal_type": "lunch", "quantity": 1},
    )
    assert log_resp.status_code == 200, log_resp.text
    assert log_resp.json()["source"] == "database"

    # The seeded-food fixture deletes food_items on teardown -- the log
    # referencing it (RESTRICT FK) must be gone first.
    SupabaseAdmin()._request(
        "DELETE", "food_logs", params={"id": f"eq.{log_resp.json()['id']}"}
    )


# ---------------------------------------------------------------------------
# Live Gemini smoke test -- skipped automatically without credentials.
# ---------------------------------------------------------------------------


@requires_supabase
@requires_gemini
def test_calculate_foods_resolves_seeded_items_via_real_gemini(client, auth_headers, seeded):
    suffix = uuid.uuid4().hex[:8]
    seeded.add(f"__aitest_paneer_{suffix}", "100g", calories=265, protein_g=18, carbs_g=6, fat_g=20)
    seeded.add(f"__aitest_roti_{suffix}", "1 piece", calories=120, protein_g=3, carbs_g=20, fat_g=3)
    text = f"200g __aitest_paneer_{suffix}, 1 __aitest_roti_{suffix}"

    resp = client.post("/api/ai/calculate-foods", headers=auth_headers, json={"text": text})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["items"]) >= 1
    assert body["total"]["calories"] >= 0
    for item in body["items"]:
        if item["resolved"]:
            assert item["calories"] is not None
            assert item["quantity"] > 0


@requires_supabase
@requires_gemini
def test_calculate_foods_estimates_a_food_with_no_database_match_via_real_gemini(
    client, auth_headers
):
    """The canonical Phase 3 example: a nutrition question about a food not
    in the database must still get a real, structured, clearly-estimated
    answer -- never a dead end."""
    resp = client.post(
        "/api/ai/calculate-foods",
        headers=auth_headers,
        json={"text": "How many calories are in 200g of paneer?"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["items"]) >= 1
    item = body["items"][0]
    assert item["resolved"] is True
    assert item["source"] in ("database", "ai_estimate")
    assert item["calories"] > 0

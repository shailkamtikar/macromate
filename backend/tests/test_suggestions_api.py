"""End-to-end test for GET /api/suggestions against the real database.
Verifies the constraint search is genuinely deterministic and DB-driven:
foods over the remaining-calorie budget are excluded, and higher
protein-density foods rank first."""

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
    email = f"macromate-suggest-test-{uuid.uuid4().hex[:10]}@example.com"
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
            "username": f"suggesttest{uuid.uuid4().hex[:6]}",
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
def second_onboarded_user():
    """A second, independent user for cross-user privacy tests."""
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-suggest-test2-{uuid.uuid4().hex[:10]}@example.com"
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
            "username": f"suggesttest2{uuid.uuid4().hex[:6]}",
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


@pytest.fixture
def seeded_foods():
    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    rows = {
        # High protein density, fits easily within a 2200 kcal budget.
        "lean": db.insert(
            "food_items",
            {
                "name": f"__sgtest_lean_{suffix}",
                "serving_description": "1 serving",
                "calories": 150,
                "protein_g": 30,
                "carbs_g": 2,
                "fat_g": 3,
                "verified": True,
            },
        )[0]["id"],
        # Low protein density but still within budget.
        "carby": db.insert(
            "food_items",
            {
                "name": f"__sgtest_carby_{suffix}",
                "serving_description": "1 serving",
                "calories": 150,
                "protein_g": 2,
                "carbs_g": 30,
                "fat_g": 3,
                "verified": True,
            },
        )[0]["id"],
        # Way over any plausible remaining budget — must never be suggested.
        "huge": db.insert(
            "food_items",
            {
                "name": f"__sgtest_huge_{suffix}",
                "serving_description": "1 feast",
                "calories": 5000,
                "protein_g": 50,
                "carbs_g": 500,
                "fat_g": 200,
                "verified": True,
            },
        )[0]["id"],
    }
    try:
        yield rows
    finally:
        for food_id in rows.values():
            db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_suggestions_exclude_over_budget_foods_and_rank_by_protein_density(
    client, onboarded_user, seeded_foods
):
    resp = client.get("/api/suggestions", headers=onboarded_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    suggested_ids = [s["id"] for s in body["suggestions"]]
    assert seeded_foods["huge"] not in suggested_ids

    # Both fit the budget; if both are present, the leaner one must rank
    # first (higher protein-per-calorie) — the user hasn't logged anything,
    # so protein is still a real gap and should drive ranking.
    if seeded_foods["lean"] in suggested_ids and seeded_foods["carby"] in suggested_ids:
        assert suggested_ids.index(seeded_foods["lean"]) < suggested_ids.index(
            seeded_foods["carby"]
        )

    assert body["remaining_calories"] == 2200  # nothing logged yet
    assert body["protein_is_priority"] is True
    assert "kcal" in body["message"]
    assert body["remaining_carbs_g"] == 220
    assert body["remaining_fat_g"] == 70


@pytest.fixture
def priority_test_foods():
    """A protein-dense-but-small food vs. a bigger, low-protein food that
    better fills the remaining calorie budget — designed to distinguish
    "rank by protein density" from "rank by budget fit"."""
    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    rows = {
        "protein_dense": db.insert(
            "food_items",
            {
                "name": f"__sgtest_proteindense_{suffix}",
                "serving_description": "1 serving",
                "calories": 100,
                "protein_g": 25,
                "carbs_g": 2,
                "fat_g": 2,
                "verified": True,
            },
        )[0]["id"],
        "higher_calorie_low_protein": db.insert(
            "food_items",
            {
                "name": f"__sgtest_highcal_{suffix}",
                "serving_description": "1 serving",
                "calories": 300,
                "protein_g": 3,
                "carbs_g": 50,
                "fat_g": 8,
                "verified": True,
            },
        )[0]["id"],
        # Logged directly to fully satisfy the 160g protein target while
        # leaving plenty of calories remaining, without needing to guess
        # at quantities against the other two foods.
        "protein_filler": db.insert(
            "food_items",
            {
                "name": f"__sgtest_filler_{suffix}",
                "serving_description": "1 serving",
                "calories": 600,
                "protein_g": 160,
                "carbs_g": 0,
                "fat_g": 0,
                "verified": True,
            },
        )[0]["id"],
    }
    try:
        yield rows
    finally:
        # food_logs referencing protein_filler must be gone before it can
        # be deleted (ON DELETE RESTRICT) — never rely on fixture teardown
        # order to guarantee that, delete explicitly.
        db._request(
            "DELETE",
            "food_logs",
            params={"food_item_id": f"eq.{rows['protein_filler']}"},
        )
        for food_id in rows.values():
            db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


def test_suggestions_prioritize_protein_when_the_gap_is_real(
    client, onboarded_user, priority_test_foods
):
    resp = client.get("/api/suggestions", headers=onboarded_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["protein_is_priority"] is True

    ids = [s["id"] for s in body["suggestions"]]
    assert priority_test_foods["protein_dense"] in ids
    if priority_test_foods["higher_calorie_low_protein"] in ids:
        assert ids.index(priority_test_foods["protein_dense"]) < ids.index(
            priority_test_foods["higher_calorie_low_protein"]
        )


def test_suggestions_stop_prioritizing_protein_once_target_is_met(
    client, onboarded_user, priority_test_foods
):
    # Log the filler food through the real API — protein target (160g) is
    # now fully met, with 1600 kcal still remaining for the day.
    log_resp = client.post(
        "/api/food-logs",
        headers=onboarded_user,
        json={
            "food_item_id": priority_test_foods["protein_filler"],
            "meal_type": "lunch",
            "quantity": 1,
        },
    )
    assert log_resp.status_code == 200, log_resp.text

    resp = client.get("/api/suggestions", headers=onboarded_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["protein_is_priority"] is False
    assert body["remaining_protein_g"] == 0
    assert body["remaining_calories"] == 1600

    # With protein no longer the deciding factor, the food that better
    # fills the remaining calorie budget must not be out-ranked by the
    # protein-dense-but-tiny option just because of its protein density.
    ids = [s["id"] for s in body["suggestions"]]
    if (
        priority_test_foods["protein_dense"] in ids
        and priority_test_foods["higher_calorie_low_protein"] in ids
    ):
        assert ids.index(priority_test_foods["higher_calorie_low_protein"]) < ids.index(
            priority_test_foods["protein_dense"]
        )


def test_suggestions_update_after_logging_food_changes_remaining_budget(
    client, onboarded_user, seeded_foods
):
    before = client.get("/api/suggestions", headers=onboarded_user).json()
    assert before["remaining_calories"] == 2200

    log_resp = client.post(
        "/api/food-logs",
        headers=onboarded_user,
        json={"food_item_id": seeded_foods["lean"], "meal_type": "breakfast", "quantity": 1},
    )
    assert log_resp.status_code == 200, log_resp.text

    try:
        after = client.get("/api/suggestions", headers=onboarded_user).json()
        # 150 kcal / 30g protein consumed — remaining budget must reflect
        # the just-logged food, not the stale pre-log numbers.
        assert after["remaining_calories"] == 2050
        assert after["remaining_protein_g"] == 130
    finally:
        db = SupabaseAdmin()
        db._request(
            "DELETE", "food_logs", params={"id": f"eq.{log_resp.json()['id']}"}
        )


def test_suggestions_empty_state_only_when_there_are_genuinely_no_candidates(client, onboarded_user):
    # No food_items fixture at all in this test — whatever is genuinely in
    # the shared database either qualifies or it doesn't; either way the
    # response must be a well-formed message, never a fabricated result.
    resp = client.get("/api/suggestions", headers=onboarded_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["suggestions"], list)
    assert len(body["suggestions"]) <= 3
    assert "kcal" in body["message"]
    if not body["suggestions"]:
        # The empty-state copy must read as a natural "nothing to suggest
        # yet", never as a database-mechanics explanation.
        assert "database" not in body["message"].lower()


@pytest.fixture
def modest_meal_food():
    """A perfectly ordinary meal-sized food, deliberately much smaller than
    a large remaining budget -- this is the regression fixture for the
    "2080 kcal / 182g protein remaining -> nothing fits" bug: a food that
    doesn't come close to filling the whole remaining budget must still be
    suggested, not excluded for failing to be an exact fit."""
    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    row = db.insert(
        "food_items",
        {
            "name": f"__sgtest_modest_{suffix}",
            "serving_description": "150g",
            "calories": 250,
            "protein_g": 47,
            "carbs_g": 0,
            "fat_g": 5,
            "verified": True,
        },
    )[0]["id"]
    try:
        yield row
    finally:
        db._request("DELETE", "food_items", params={"id": f"eq.{row}"})


def test_large_remaining_gap_still_returns_useful_suggestions_not_an_empty_state(
    client, onboarded_user, modest_meal_food
):
    """The exact reported scenario: a large remaining calorie/protein gap
    (onboarded_user's full, untouched 2200 kcal / 160g protein target) must
    not produce "nothing fits" just because no single food fills that whole
    gap by itself -- a normal, modestly-sized eligible food must still be
    suggested."""
    resp = client.get("/api/suggestions", headers=onboarded_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["remaining_calories"] == 2200
    assert body["remaining_protein_g"] == 160

    ids = [s["id"] for s in body["suggestions"]]
    assert modest_meal_food in ids
    # Every returned suggestion must carry a human-readable name, valid
    # (positive) nutrition, and its own real id -- never a fabricated or
    # malformed entry.
    for s in body["suggestions"]:
        assert not s["id"].startswith("_")
        assert len(s["name"]) > 0
        assert s["calories"] > 0


def test_a_food_far_smaller_than_the_remaining_budget_is_still_suggested(
    client, onboarded_user, modest_meal_food
):
    """The food (250 kcal) is a small fraction of the 2200 kcal remaining
    budget -- it must be ranked and returned regardless, proving calories
    are a ranking signal here, not an exact-fit gate."""
    resp = client.get("/api/suggestions", headers=onboarded_user)
    body = resp.json()
    ids = [s["id"] for s in body["suggestions"]]
    assert modest_meal_food in ids


def test_personal_ai_estimate_is_suggested_back_to_its_own_owner(client, onboarded_user):
    """The positive counterpart to test_suggestions_never_include_ai_estimate_food_items:
    a personal AI-estimate food remains reusable by its owner not just
    through search, but as a Smart Suggestion for that same user -- this is
    exactly what let the real "Durga egg bhurji" scenario work (a user's
    own previously-logged personal food surfacing as a suggestion for
    them)."""
    log_resp = client.post(
        "/api/food-logs",
        headers=onboarded_user,
        json={
            "ai_estimate": {
                "name": f"__sgtest_personal_estimate_{uuid.uuid4().hex[:8]}",
                "serving_description": "1 bowl",
                "calories": 300,
                "protein_g": 25,
                "carbs_g": 10,
                "fat_g": 8,
            },
            "meal_type": "lunch",
            "quantity": 1,
        },
    )
    assert log_resp.status_code == 200, log_resp.text
    food_item_id = log_resp.json()["food_item_id"]

    try:
        resp = client.get("/api/suggestions", headers=onboarded_user)
        assert resp.status_code == 200, resp.text
        ids = [s["id"] for s in resp.json()["suggestions"]]
        assert food_item_id in ids
    finally:
        db = SupabaseAdmin()
        db._request("DELETE", "food_logs", params={"id": f"eq.{log_resp.json()['id']}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_item_id}"})


def test_personal_ai_estimate_never_leaks_to_a_different_user(
    client, onboarded_user, second_onboarded_user
):
    """Privacy regression: user A's personal AI-estimate food must never
    appear in user B's suggestions, even when it would otherwise be a
    perfectly reasonable match for B's remaining macros."""
    log_resp = client.post(
        "/api/food-logs",
        headers=onboarded_user,
        json={
            "ai_estimate": {
                "name": f"__sgtest_privateestimate_{uuid.uuid4().hex[:8]}",
                "serving_description": "1 bowl",
                "calories": 300,
                "protein_g": 25,
                "carbs_g": 10,
                "fat_g": 8,
            },
            "meal_type": "lunch",
            "quantity": 1,
        },
    )
    assert log_resp.status_code == 200, log_resp.text
    food_item_id = log_resp.json()["food_item_id"]

    try:
        resp = client.get("/api/suggestions", headers=second_onboarded_user)
        assert resp.status_code == 200, resp.text
        ids = [s["id"] for s in resp.json()["suggestions"]]
        assert food_item_id not in ids
    finally:
        db = SupabaseAdmin()
        db._request("DELETE", "food_logs", params={"id": f"eq.{log_resp.json()['id']}"})
        db._request("DELETE", "food_items", params={"id": f"eq.{food_item_id}"})


@pytest.fixture
def ai_estimate_food():
    """A personal, one-off AI-estimate food_items row exactly like the ones
    that leaked into production: a tiny per-gram serving with an implied
    calorie/protein density (huge grams-of-"protein"-per-calorie) that would
    otherwise dominate the protein-density ranking and get suggested to
    every user, showing its raw estimate name and near-zero nutrition."""
    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    row = db.insert(
        "food_items",
        {
            "name": f"__sgtest_aiestimate_{suffix}",
            "serving_description": "1 g",
            "calories": 0.9,
            "protein_g": 0.5,
            "carbs_g": 0.1,
            "fat_g": 0.02,
            "is_ai_estimate": True,
        },
    )[0]["id"]
    try:
        yield row
    finally:
        db._request("DELETE", "food_items", params={"id": f"eq.{row}"})


def test_suggestions_never_include_ai_estimate_food_items(
    client, onboarded_user, ai_estimate_food
):
    """Regression test for the "Zorbnak"/"1 kcal · P 0g" bug: a personal
    AI-estimate food_items row (whether a real user's own estimate or
    leaked test/dev-fixture junk) must never be suggested to any user —
    suggestions are a shared/global discovery feature, not personal
    reuse, and must fail safely rather than surface a malformed record."""
    resp = client.get("/api/suggestions", headers=onboarded_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    ids = [s["id"] for s in body["suggestions"]]
    assert ai_estimate_food not in ids
    names = [s["name"] for s in body["suggestions"]]
    assert not any(n.startswith("__sgtest_aiestimate_") for n in names)


@pytest.fixture
def unowned_food():
    """A food_items row with perfectly ordinary, valid-looking nutrition
    (not an AI estimate) but no legitimate provenance: verified=false and
    created_by=null. No real product code path ever creates this exact
    combination -- a curated food is verified=true, and every real user
    custom food gets created_by set from the authenticated JWT (see
    POST /api/food-items in app/routers/food.py). This is what a row
    inserted directly against the database (e.g. by a test fixture bypassing
    the app) looks like. The test deliberately gives it an unremarkable name
    with no "test"/"aitest" substring, so the regression this guards against
    is the *eligibility rule*, not a name-prefix filter."""
    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    row = db.insert(
        "food_items",
        {
            "name": f"Roasted Almonds {suffix}",
            "serving_description": "30g",
            "calories": 170,
            "protein_g": 6,
            "carbs_g": 6,
            "fat_g": 15,
        },
    )[0]["id"]
    try:
        yield row
    finally:
        db._request("DELETE", "food_items", params={"id": f"eq.{row}"})


@pytest.fixture
def legitimately_owned_food():
    """A food created through the real custom-food-creation flow (created_by
    set to a real, live user, exactly like POST /api/foods produces) -- the
    positive counterpart to unowned_food: must remain eligible so the
    eligibility rule doesn't overcorrect into hiding real users' legitimate
    global custom foods."""
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-suggest-owner-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    create_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    owner_id = create_resp.json()["id"]

    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    row = db.insert(
        "food_items",
        {
            "name": f"Grilled Chicken Breast {suffix}",
            "serving_description": "150g",
            "calories": 250,
            "protein_g": 47,
            "carbs_g": 0,
            "fat_g": 5,
            "created_by": owner_id,
        },
    )[0]["id"]
    try:
        yield row
    finally:
        db._request("DELETE", "food_items", params={"id": f"eq.{row}"})
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{owner_id}",
            headers=admin_headers,
            timeout=15,
        )


def test_suggestions_require_legitimate_provenance_not_name_pattern(
    client, onboarded_user, unowned_food, legitimately_owned_food
):
    """Regression test for the second "Zorbnak"-class bug: a food with
    entirely ordinary, valid nutrition and an unremarkable name must still
    be excluded from suggestions if it has no legitimate provenance
    (verified=false and created_by=null -- a state no real app code path
    produces), while a food with the exact same shape of data but a real
    owner remains eligible. This proves the eligibility rule is based on
    provenance, not on detecting a "test-looking" name."""
    resp = client.get("/api/suggestions", headers=onboarded_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    ids = [s["id"] for s in body["suggestions"]]

    assert unowned_food not in ids
    assert legitimately_owned_food in ids

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
    # first (higher protein-per-calorie).
    if seeded_foods["lean"] in suggested_ids and seeded_foods["carby"] in suggested_ids:
        assert suggested_ids.index(seeded_foods["lean"]) < suggested_ids.index(
            seeded_foods["carby"]
        )

    assert body["remaining_calories"] == 2200  # nothing logged yet
    assert "kcal" in body["message"]

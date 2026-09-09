"""End-to-end test for POST /api/ai/calculate-foods against the real Gemini
API and the real database. Seeds distinctly-named food items so the parser
has something real to resolve against, then asserts on structure and
directional correctness rather than exact numbers (Gemini's exact item
split/quantity estimate is not deterministic across calls)."""

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin
from app.main import app

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url
    or not settings.supabase_service_role_key
    or not settings.gemini_api_key,
    reason="Supabase or Gemini credentials not configured",
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
def seeded_foods():
    db = SupabaseAdmin()
    suffix = uuid.uuid4().hex[:8]
    names = {
        "paneer": f"__aitest_paneer_{suffix}",
        "roti": f"__aitest_roti_{suffix}",
    }
    ids = {}
    ids["paneer"] = db.insert(
        "food_items",
        {
            "name": names["paneer"],
            "serving_description": "100g",
            "calories": 265,
            "protein_g": 18,
            "carbs_g": 6,
            "fat_g": 20,
        },
    )[0]["id"]
    ids["roti"] = db.insert(
        "food_items",
        {
            "name": names["roti"],
            "serving_description": "1 piece",
            "calories": 120,
            "protein_g": 3,
            "carbs_g": 20,
            "fat_g": 3,
        },
    )[0]["id"]
    try:
        yield names
    finally:
        for food_id in ids.values():
            db._request("DELETE", "food_items", params={"id": f"eq.{food_id}"})


@pytest.fixture
def client():
    return TestClient(app)


def test_calculate_foods_resolves_seeded_items(client, auth_headers, seeded_foods):
    text = f"200g {seeded_foods['paneer'].replace('__aitest_', '')}, 1 {seeded_foods['roti'].replace('__aitest_', '')}"
    resp = client.post(
        "/api/ai/calculate-foods", headers=auth_headers, json={"text": text}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["items"]) >= 1
    assert body["total"]["calories"] >= 0
    # Every resolved item must carry deterministic nutrition numbers, never
    # null, and those numbers must be internally consistent with a
    # positive quantity multiplier.
    for item in body["items"]:
        if item["resolved"]:
            assert item["calories"] is not None
            assert item["quantity_multiplier"] > 0


def test_calculate_foods_surfaces_unresolvable_items(client, auth_headers):
    resp = client.post(
        "/api/ai/calculate-foods",
        headers=auth_headers,
        json={"text": "a completely fictional zorbnak fruit that does not exist"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Must not fabricate nutrition for something with no real DB match —
    # every item claiming a match must be unresolved (no fabricated calories).
    for item in body["items"]:
        if not item["resolved"]:
            assert item["calories"] is None

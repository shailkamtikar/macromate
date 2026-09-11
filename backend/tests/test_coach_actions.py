"""Deterministic tests for app/domain/coach_actions.py against the real
database -- no Gemini involved (ParsedFoodItem is constructed directly),
matching how app/routers/coach.py calls these functions after Gemini has
already been reduced to a validated, structured CoachIntent."""

import uuid

import httpx
import pytest

from app.core.config import get_settings
from app.core.supabase_admin import SupabaseAdmin
from app.domain.ai_food_parser import ParsedFoodItem
from app.domain.coach_actions import execute_add_food, execute_log_water, execute_remove_food

settings = get_settings()

pytestmark = pytest.mark.skipif(
    not settings.supabase_url or not settings.supabase_service_role_key,
    reason="Supabase credentials not configured",
)


def _delete_ai_estimate_food_items_for_user(db: SupabaseAdmin, user_id: str) -> None:
    """execute_add_food's estimate-fallback path (see
    get_or_create_personal_food) can create a new food_items row scoped to
    this user that the test never explicitly tracks. food_items.created_by
    is ON DELETE SET NULL, so simply deleting the auth user orphans these
    rows forever instead of removing them -- they then sit in the real
    database and can leak into other users' smart-food-suggestions results.
    Must run *before* the user is deleted, while created_by is still set."""
    rows = db.select(
        "food_items", {"created_by": f"eq.{user_id}", "is_ai_estimate": "eq.true", "select": "id"}
    )
    for row in rows:
        db._request("DELETE", "food_logs", params={"food_item_id": f"eq.{row['id']}"})
    for row in rows:
        db._request("DELETE", "food_items", params={"id": f"eq.{row['id']}"})


@pytest.fixture
def user_id():
    admin_headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    email = f"macromate-coachaction-test-{uuid.uuid4().hex[:10]}@example.com"
    password = f"Tt{uuid.uuid4().hex}!1"
    resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=admin_headers,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    assert resp.status_code in (200, 201), resp.text
    uid = resp.json()["id"]
    try:
        yield uid
    finally:
        _delete_ai_estimate_food_items_for_user(SupabaseAdmin(), uid)
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{uid}",
            headers=admin_headers,
            timeout=15,
        )


@pytest.fixture
def db():
    return SupabaseAdmin()


def _item(search_name, amount, unit, **overrides) -> ParsedFoodItem:
    base = dict(
        raw_phrase=f"{amount}{unit} {search_name}",
        search_name=search_name,
        amount=amount,
        unit=unit,
        estimated_calories=300,
        estimated_protein_g=20,
        estimated_carbs_g=15,
        estimated_fat_g=12,
        assumption="",
    )
    base.update(overrides)
    return ParsedFoodItem(**base)


def _food_logs(db, user_id):
    return db.select(
        "food_logs",
        {"user_id": f"eq.{user_id}", "select": "*,food_items(name)"},
    )


class _SeededFood:
    def __init__(self, db):
        self.db = db
        self.ids: list[str] = []

    def add(self, name, serving_description, **macros):
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
def seeded(db):
    s = _SeededFood(db)
    try:
        yield s
    finally:
        s.cleanup()


def test_add_food_with_database_match_logs_with_database_provenance(db, seeded, user_id):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_coach_paneer_{suffix}"
    seeded.add(name, "100g", calories=265, protein_g=18, carbs_g=6, fat_g=20)

    result = execute_add_food(db, user_id, [_item(name, 200, "g")], "lunch")

    assert len(result.logged) == 1
    assert result.logged[0].source == "database"
    assert result.logged[0].calories == pytest.approx(265 * 2, abs=0.5)

    logs = _food_logs(db, user_id)
    assert len(logs) == 1
    assert logs[0]["meal_type"] == "lunch"
    assert logs[0]["source"] == "database"


def test_add_food_with_no_match_logs_with_ai_estimate_provenance(db, user_id):
    unique = uuid.uuid4().hex
    result = execute_add_food(
        db,
        user_id,
        [_item(f"zorbnak{unique}", 1, "serving", estimated_calories=250)],
        "snack",
    )

    assert len(result.logged) == 1
    assert result.logged[0].source == "ai_estimate"
    assert result.logged[0].calories == pytest.approx(250)

    logs = _food_logs(db, user_id)
    assert len(logs) == 1
    assert logs[0]["source"] == "ai_estimate"
    # A real, ownership-scoped food_items row was created to back it.
    assert logs[0]["food_item_id"] is not None


def test_add_food_reuses_this_users_existing_personal_ai_estimate_food(db, user_id):
    """Accepting the same unmatched food twice (e.g. two separate "add
    <food>" commands) must reuse the one personal food_items row created
    the first time, not create a near-duplicate every time."""
    unique = uuid.uuid4().hex
    name = f"zorbnak{unique}"

    first = execute_add_food(
        db, user_id, [_item(name, 200, "g", estimated_calories=180)], "lunch"
    )
    second = execute_add_food(
        db, user_id, [_item(name, 100, "g", estimated_calories=90)], "snack"
    )

    logs = _food_logs(db, user_id)
    assert len(logs) == 2
    food_item_ids = {log["food_item_id"] for log in logs}
    assert len(food_item_ids) == 1
    assert first.logged[0].source == second.logged[0].source == "ai_estimate"

    rows = db.select("food_items", {"name": f"ilike.*{unique}*", "select": "id"})
    assert len(rows) == 1


def test_add_food_ai_estimate_food_is_not_matched_for_a_different_user(db, user_id):
    """Personal AI-estimate foods must never leak across users, including
    through the Coach's own add-food resolution -- a second user asking to
    add a similarly-named food must get their own fresh estimate/food, not
    silently reuse or be blocked by the first user's row."""
    other_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers={
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        },
        json={
            "email": f"macromate-coachaction-other2-{uuid.uuid4().hex[:10]}@example.com",
            "password": f"Tt{uuid.uuid4().hex}!1",
            "email_confirm": True,
        },
        timeout=15,
    )
    other_user_id = other_resp.json()["id"]
    unique = uuid.uuid4().hex
    name = f"zorbnak{unique}"
    try:
        first = execute_add_food(
            db, user_id, [_item(name, 200, "g", estimated_calories=180)], "lunch"
        )
        second = execute_add_food(
            db, other_user_id, [_item(name, 200, "g", estimated_calories=180)], "lunch"
        )

        first_food_id = _food_logs(db, user_id)[0]["food_item_id"]
        second_food_id = _food_logs(db, other_user_id)[0]["food_item_id"]
        assert first_food_id != second_food_id

        rows = db.select("food_items", {"name": f"ilike.*{unique}*", "select": "id,created_by"})
        assert len(rows) == 2
        assert {r["created_by"] for r in rows} == {user_id, other_user_id}
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{other_user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=15,
        )


def test_add_food_multiple_items_logs_all_and_sums_total(db, seeded, user_id):
    suffix = uuid.uuid4().hex[:10]
    paneer = f"__aitest_coach_paneer_{suffix}"
    roti = f"__aitest_coach_roti_{suffix}"
    seeded.add(paneer, "100g", calories=265, protein_g=18, carbs_g=6, fat_g=20)
    seeded.add(roti, "1 piece", calories=120, protein_g=3, carbs_g=20, fat_g=3)

    result = execute_add_food(
        db, user_id, [_item(paneer, 200, "g"), _item(roti, 2, "serving")], "lunch"
    )

    assert len(result.logged) == 2
    assert result.total_calories == pytest.approx(265 * 2 + 120 * 2, abs=0.5)
    assert len(_food_logs(db, user_id)) == 2


def test_add_food_ambiguous_database_match_falls_back_to_estimate_not_a_guess(
    db, seeded, user_id
):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_coach_amb_{suffix}"
    seeded.add(name, "1 bowl", calories=150, protein_g=5, carbs_g=20, fat_g=4)
    seeded.add(name, "1 cup", calories=400, protein_g=25, carbs_g=10, fat_g=30)

    result = execute_add_food(
        db, user_id, [_item(name, 1, "serving", estimated_calories=222)], "dinner"
    )

    # The Coach can't hold an interactive disambiguation mid-chat, so it
    # must not silently pick one of two real database entries -- it uses
    # the clearly-labeled estimate instead.
    assert len(result.logged) == 1
    assert result.logged[0].source == "ai_estimate"
    assert result.logged[0].calories == pytest.approx(222)


def test_remove_food_unambiguous_match_removes_it(db, seeded, user_id):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_coach_removeme_{suffix}"
    food_id = seeded.add(name, "1 bowl", calories=200)
    db.insert(
        "food_logs",
        {
            "user_id": user_id,
            "food_item_id": food_id,
            "meal_type": "lunch",
            "quantity": 1,
            "calories": 200,
            "protein_g": 10,
            "carbs_g": 20,
            "fat_g": 5,
        },
    )

    result = execute_remove_food(db, user_id, name.replace("__aitest_coach_", ""))

    assert result.removed is True
    assert len(_food_logs(db, user_id)) == 0


def test_remove_food_no_match_does_not_remove_anything(db, seeded, user_id):
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_coach_keepme_{suffix}"
    food_id = seeded.add(name, "1 bowl", calories=200)
    db.insert(
        "food_logs",
        {
            "user_id": user_id,
            "food_item_id": food_id,
            "meal_type": "lunch",
            "quantity": 1,
            "calories": 200,
            "protein_g": 10,
            "carbs_g": 20,
            "fat_g": 5,
        },
    )

    result = execute_remove_food(db, user_id, "a totally different food name entirely")

    assert result.removed is False
    assert result.reason == "not_found"
    assert len(_food_logs(db, user_id)) == 1


def test_remove_food_ambiguous_match_does_not_remove_anything(db, seeded, user_id):
    suffix = uuid.uuid4().hex[:10]
    shared_word = f"chicken{suffix}"
    id_a = seeded.add(f"{shared_word} curry", "1 bowl", calories=200)
    id_b = seeded.add(f"{shared_word} tikka", "1 bowl", calories=250)
    for food_id in (id_a, id_b):
        db.insert(
            "food_logs",
            {
                "user_id": user_id,
                "food_item_id": food_id,
                "meal_type": "dinner",
                "quantity": 1,
                "calories": 200,
                "protein_g": 10,
                "carbs_g": 20,
                "fat_g": 5,
            },
        )

    result = execute_remove_food(db, user_id, shared_word)

    # Two plausible matches -- an irreversible delete must not guess.
    assert result.removed is False
    assert result.reason == "ambiguous"
    assert len(_food_logs(db, user_id)) == 2


def test_remove_food_only_matches_todays_own_logs_for_this_user(db, seeded, user_id):
    """User isolation: a food logged by a DIFFERENT user with a matching
    name must never be touched."""
    other_resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers={
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        },
        json={
            "email": f"macromate-coachaction-other-{uuid.uuid4().hex[:10]}@example.com",
            "password": f"Tt{uuid.uuid4().hex}!1",
            "email_confirm": True,
        },
        timeout=15,
    )
    other_user_id = other_resp.json()["id"]
    suffix = uuid.uuid4().hex[:10]
    name = f"__aitest_coach_isolation_{suffix}"
    food_id = seeded.add(name, "1 bowl", calories=200)
    try:
        db.insert(
            "food_logs",
            {
                "user_id": other_user_id,
                "food_item_id": food_id,
                "meal_type": "lunch",
                "quantity": 1,
                "calories": 200,
                "protein_g": 10,
                "carbs_g": 20,
                "fat_g": 5,
            },
        )

        result = execute_remove_food(db, user_id, name.replace("__aitest_coach_", ""))

        assert result.removed is False
        assert result.reason == "not_found"
        assert len(_food_logs(db, other_user_id)) == 1
    finally:
        httpx.delete(
            f"{settings.supabase_url}/auth/v1/admin/users/{other_user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=15,
        )


def test_log_water_inserts_and_returns_running_total(db, user_id):
    result = execute_log_water(db, user_id, 250)
    assert result.total_ml == pytest.approx(250)

    result = execute_log_water(db, user_id, 500)
    assert result.total_ml == pytest.approx(750)

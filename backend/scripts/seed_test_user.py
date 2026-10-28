"""Seeds the TEST Supabase project with 3 users and ~35 days of realistic data.

Never run against production: it refuses unless backend/.env and
backend/.env.prod point at different projects. Run from backend/:

    PYTHONPATH=. uv run python scripts/seed_test_user.py

Users (password for all: Test@12345):
    tester.a@example.com  - fully onboarded, 35 days of logs, friends with B
    tester.b@example.com  - onboarded, light logging, owns the copied foods
    tester.c@example.com  - NOT onboarded (use it to test the wizard)
"""

import random
import sys
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import dotenv_values

from app.core.supabase_admin import service_headers

PASSWORD = "Test@12345"
USERS = {
    "a": "tester.a@example.com",
    "b": "tester.b@example.com",
    "c": "tester.c@example.com",
}
TZ = "Asia/Kolkata"
IST = timezone(timedelta(hours=5, minutes=30))

env = dotenv_values(".env")
prod = dotenv_values(".env.prod")
URL = env["SUPABASE_URL"]
HEADERS = service_headers(env["SUPABASE_SERVICE_ROLE_KEY"])


def rest(method, path, headers=None, **kw):
    r = httpx.request(
        method, f"{URL}/rest/v1/{path}", headers={**HEADERS, **(headers or {})}, timeout=60, **kw
    )
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path}: {r.status_code} {r.text[:300]}")
    return r.json() if r.text else None


def ensure_user(email: str) -> str:
    r = httpx.post(
        f"{URL}/auth/v1/admin/users",
        headers=HEADERS,
        json={"email": email, "password": PASSWORD, "email_confirm": True},
        timeout=60,
    )
    if r.status_code in (200, 201):
        return r.json()["id"]
    listing = httpx.get(
        f"{URL}/auth/v1/admin/users", headers=HEADERS, params={"per_page": 200}, timeout=60
    ).json()
    for u in listing.get("users", []):
        if u["email"] == email:
            return u["id"]
    raise RuntimeError(f"cannot create/find {email}: {r.status_code} {r.text[:200]}")


def profile_row(uid: str, username: str, cal: int):
    return {
        "id": uid,
        "username": username,
        "sex": "male",
        "age_years": 28,
        "height_cm": 178,
        "activity_level": "moderate",
        "goal": "cut",
        "rate_kg_per_week": 0.5,
        "macro_mode": "automatic",
        "dietary_mode": "non_vegetarian",
        "target_calories": cal,
        "target_protein_g": 160,
        "target_carbs_g": 220,
        "target_fat_g": 65,
        "water_goal_ml": 3000,
        "timezone": TZ,
        "leaderboard_visible": True,
    }


def main() -> int:
    if env["SUPABASE_URL"] == prod.get("SUPABASE_URL"):
        print("Refusing: .env points at production.")
        return 1
    ids = {k: ensure_user(e) for k, e in USERS.items()}
    print("users:", ids)

    rest("POST", "profiles", params={"on_conflict": "id"},
         headers={"Prefer": "resolution=merge-duplicates"},
         json=[profile_row(ids["a"], "tester_a", 2200), profile_row(ids["b"], "tester_b", 2400)])

    # Give the copied foods a (test) owner so they count as "real user" foods.
    rest("PATCH", "food_items", params={"created_by": "is.null"}, json={"created_by": ids["b"]})
    foods = rest("GET", "food_items", params={"select": "*", "is_ai_estimate": "eq.false"})
    if not foods:
        print("No foods found: run scripts/copy_foods.py first.")
        return 1

    # A <-> B friends.
    existing = rest("GET", "friendships", params={"requester_id": f"eq.{ids['a']}", "addressee_id": f"eq.{ids['b']}"})
    if not existing:
        rest("POST", "friendships", json={"requester_id": ids["a"], "addressee_id": ids["b"], "status": "accepted"})

    # Wipe + reseed A's history so the script is idempotent.
    for table in ("food_logs", "water_logs", "weight_logs"):
        rest("DELETE", table, params={"user_id": f"eq.{ids['a']}"})

    rng = random.Random(42)
    now = datetime.now(IST)
    slots = {"breakfast": 8, "lunch": 13, "dinner": 20, "snack": 17}
    food_rows, water_rows, weight_rows = [], [], []
    for day in range(35, 0, -1):
        d = (now - timedelta(days=day)).replace(minute=15, second=0, microsecond=0)
        if rng.random() < 0.12:  # an occasional skipped day
            continue
        for meal, hour in slots.items():
            if meal == "snack" and rng.random() < 0.5:
                continue
            for food in rng.sample(foods, k=rng.randint(1, 2)):
                qty = rng.choice([0.5, 1, 1, 1.5, 2])
                food_rows.append({
                    "user_id": ids["a"],
                    "food_item_id": food["id"],
                    "meal_type": meal,
                    "quantity": qty,
                    "calories": round(food["calories"] * qty, 2),
                    "protein_g": round(food["protein_g"] * qty, 2),
                    "carbs_g": round(food["carbs_g"] * qty, 2),
                    "fat_g": round(food["fat_g"] * qty, 2),
                    "source": "database",
                    "logged_at": d.replace(hour=hour).astimezone(timezone.utc).isoformat(),
                })
        for h in (9, 12, 15, 18, 21):
            water_rows.append({
                "user_id": ids["a"],
                "volume_ml": rng.choice([250, 250, 500]),
                "logged_at": d.replace(hour=h).astimezone(timezone.utc).isoformat(),
            })
        if day % 5 == 0:
            weight_rows.append({
                "user_id": ids["a"],
                "weight_kg": round(82 - (35 - day) * 0.08 + rng.uniform(-0.3, 0.3), 1),
                "logged_at": d.replace(hour=7).astimezone(timezone.utc).isoformat(),
            })
    for i in range(0, len(food_rows), 200):
        rest("POST", "food_logs", json=food_rows[i : i + 200])
    rest("POST", "water_logs", json=water_rows)
    rest("POST", "weight_logs", json=weight_rows)
    print(f"seeded A: {len(food_rows)} food logs, {len(water_rows)} water logs, {len(weight_rows)} weights")
    return 0


if __name__ == "__main__":
    sys.exit(main())

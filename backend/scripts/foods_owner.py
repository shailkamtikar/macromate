"""Attach/detach the copied foods to the test user B (TEST project only).

Suggestion tests (pytest + e2e) assume the shared food pool holds nothing but
their own fixtures, but the app itself needs the foods to be visible
("real user" foods, created_by not null) for a realistic demo:

    PYTHONPATH=. uv run python scripts/foods_owner.py detach   # before running tests
    PYTHONPATH=. uv run python scripts/foods_owner.py attach   # for manual testing / demos
"""

import sys

import httpx
from dotenv import dotenv_values

from app.core.supabase_admin import service_headers

env = dotenv_values(".env")
prod = dotenv_values(".env.prod")
if env["SUPABASE_URL"] == prod.get("SUPABASE_URL"):
    sys.exit("Refusing: .env points at production.")
H = service_headers(env["SUPABASE_SERVICE_ROLE_KEY"])
URL = env["SUPABASE_URL"]


def tester_b_id() -> str:
    users = httpx.get(f"{URL}/auth/v1/admin/users", headers=H, params={"per_page": 200}).json()["users"]
    return next(u["id"] for u in users if u["email"] == "tester.b@example.com")


mode = sys.argv[1] if len(sys.argv) > 1 else ""
b = tester_b_id()
if mode == "detach":
    r = httpx.patch(f"{URL}/rest/v1/food_items", headers=H, params={"created_by": f"eq.{b}"}, json={"created_by": None})
elif mode == "attach":
    r = httpx.patch(f"{URL}/rest/v1/food_items", headers=H, params={"created_by": "is.null", "verified": "eq.false"}, json={"created_by": b})
else:
    sys.exit("usage: foods_owner.py attach|detach")
r.raise_for_status()
print(mode, "ok")

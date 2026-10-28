"""Copies food_items from PRODUCTION into the TEST Supabase project.

Production is only ever READ (GET). Writes go exclusively to the project
configured in backend/.env (the test project). Run from backend/:

    uv run python scripts/copy_foods.py
"""

import sys

import httpx
from dotenv import dotenv_values

from app.core.supabase_admin import service_headers

PAGE = 1000
COLUMNS = (
    "id,name,brand,serving_description,calories,protein_g,carbs_g,fat_g,"
    "fiber_g,sugar_g,sodium_mg,verified,created_at"
)


def main() -> int:
    prod = dotenv_values(".env.prod")
    test = dotenv_values(".env")
    if prod["SUPABASE_URL"] == test["SUPABASE_URL"]:
        print("Refusing to run: .env and .env.prod point at the same project.")
        return 1

    prod_headers = service_headers(prod["SUPABASE_SERVICE_ROLE_KEY"])
    test_headers = service_headers(test["SUPABASE_SERVICE_ROLE_KEY"])
    test_headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    copied = 0
    offset = 0
    while True:
        resp = httpx.get(
            f"{prod['SUPABASE_URL']}/rest/v1/food_items",
            headers=prod_headers,  # production: GET only
            params={
                "select": COLUMNS,
                "is_ai_estimate": "eq.false",
                "order": "created_at.asc,id.asc",
                "limit": PAGE,
                "offset": offset,
            },
            timeout=60,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            break
        # created_by points at production users that don't exist here.
        for row in rows:
            row["created_by"] = None
        out = httpx.post(
            f"{test['SUPABASE_URL']}/rest/v1/food_items",
            headers=test_headers,
            json=rows,
            timeout=60,
        )
        out.raise_for_status()
        copied += len(rows)
        offset += PAGE
        print(f"copied {copied}")
    print(f"done: {copied} foods")
    return 0


if __name__ == "__main__":
    sys.exit(main())

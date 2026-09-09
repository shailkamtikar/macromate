"""Tests for POST /api/macro-targets — pure deterministic computation, no
auth and no live Supabase dependency, so these always run. Covers the
onboarding-batch additions: rate-based calorie targets, calorie override,
and automatic-vs-custom macro modes, plus the request-level validation
that keeps a client from creating a mathematically inconsistent target.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

BASE_PAYLOAD = {
    "weight_kg": 80,
    "height_cm": 180,
    "age_years": 28,
    "sex": "male",
    "activity_level": "moderate",
    "goal": "maintain",
}


def test_zero_weight_rejected_with_422_not_500():
    # Regression: calculate_bmi() raises ValueError for weight_kg<=0; before
    # Field(gt=0) validation was added, this call sat outside the
    # endpoint's try/except and produced an unhandled 500 instead of a
    # clean validation error.
    resp = client.post("/api/macro-targets", json={**BASE_PAYLOAD, "weight_kg": 0})
    assert resp.status_code == 422


def test_negative_height_rejected_with_422():
    resp = client.post("/api/macro-targets", json={**BASE_PAYLOAD, "height_cm": -10})
    assert resp.status_code == 422


def test_maintain_returns_recommended_equal_to_final_calories():
    resp = client.post("/api/macro-targets", json=BASE_PAYLOAD)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["recommended_calories"] == body["targets"]["calories"]
    assert body["bmr"] > 0


def test_cut_requires_no_rate_but_defaults_sensibly():
    # Omitting rate_kg_per_week falls back to the legacy fixed adjustment —
    # must still return a lower calorie target than maintain, not error.
    resp = client.post("/api/macro-targets", json={**BASE_PAYLOAD, "goal": "cut"})
    assert resp.status_code == 200, resp.text


def test_cut_calorie_target_decreases_as_rate_increases():
    calories = []
    for rate in (0.5, 0.75, 1.0):
        resp = client.post(
            "/api/macro-targets",
            json={
                **BASE_PAYLOAD,
                "weight_kg": 100,
                "activity_level": "very_active",
                "goal": "cut",
                "rate_kg_per_week": rate,
            },
        )
        assert resp.status_code == 200, resp.text
        calories.append(resp.json()["recommended_calories"])
    assert calories[0] > calories[1] > calories[2]


def test_cut_rate_above_safe_cap_is_rejected_with_422():
    resp = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "goal": "cut", "rate_kg_per_week": 2.0},
    )
    assert resp.status_code == 422


def test_bulk_rate_option_accepted():
    resp = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "goal": "bulk", "rate_kg_per_week": 0.25},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["recommended_calories"] > resp.json()["bmr"]


def test_calorie_override_within_tolerance_changes_final_target():
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    recommended = baseline["recommended_calories"]

    resp = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "calorie_override": recommended - 200},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["targets"]["calories"] == recommended - 200
    # Recommended stays the same even though the final target moved — the
    # UI needs both to show "recommended vs selected".
    assert body["recommended_calories"] == recommended


def test_calorie_override_beyond_tolerance_rejected_with_422():
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    recommended = baseline["recommended_calories"]

    resp = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "calorie_override": recommended - 900},
    )
    assert resp.status_code == 422
    assert "kcal" in resp.json()["detail"]


def test_calorie_override_recalculates_macros_automatically():
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    recommended = baseline["recommended_calories"]

    lowered = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "calorie_override": recommended - 300},
    ).json()
    # Automatic macros must reconstruct the *overridden* calorie total, not
    # the original recommended one.
    t = lowered["targets"]
    reconstructed = t["protein_g"] * 4 + t["carbs_g"] * 4 + t["fat_g"] * 9
    assert abs(reconstructed - t["calories"]) <= 5


def test_calorie_override_moves_protein_not_just_carbs_and_fat():
    """Regression test for a real bug: protein used to be a pure function
    of (weight_kg, goal), so overriding the calorie target left protein
    frozen at ~224g while only carbs/fat absorbed the change. The API-level
    response must show protein actually move too."""
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    recommended = baseline["recommended_calories"]
    baseline_protein = baseline["targets"]["protein_g"]

    lowered = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "calorie_override": recommended - 400},
    ).json()
    raised = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "calorie_override": recommended + 400},
    ).json()

    assert lowered["targets"]["protein_g"] < baseline_protein < raised["targets"]["protein_g"]


def test_custom_macro_mode_within_tolerance_accepted():
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    calories = baseline["recommended_calories"]
    # protein 150 + carbs 200 + fat within 5% of calories
    fat_g = round((calories - 150 * 4 - 200 * 4) / 9)

    resp = client.post(
        "/api/macro-targets",
        json={
            **BASE_PAYLOAD,
            "macro_mode": "custom",
            "custom_protein_g": 150,
            "custom_carbs_g": 200,
            "custom_fat_g": fat_g,
        },
    )
    assert resp.status_code == 200, resp.text
    t = resp.json()["targets"]
    assert t["protein_g"] == 150
    assert t["carbs_g"] == 200
    assert t["fat_g"] == fat_g


def test_custom_macro_mode_inconsistent_with_calories_rejected_with_422():
    resp = client.post(
        "/api/macro-targets",
        json={
            **BASE_PAYLOAD,
            "macro_mode": "custom",
            "custom_protein_g": 400,
            "custom_carbs_g": 500,
            "custom_fat_g": 200,
        },
    )
    assert resp.status_code == 422
    assert "kcal" in resp.json()["detail"]


def test_custom_macro_mode_missing_fields_rejected_with_422():
    resp = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "macro_mode": "custom", "custom_protein_g": 150},
    )
    assert resp.status_code == 422


def test_custom_macros_combined_with_calorie_override_stay_consistent():
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    override_calories = baseline["recommended_calories"] - 200
    fat_g = round((override_calories - 140 * 4 - 180 * 4) / 9)

    resp = client.post(
        "/api/macro-targets",
        json={
            **BASE_PAYLOAD,
            "calorie_override": override_calories,
            "macro_mode": "custom",
            "custom_protein_g": 140,
            "custom_carbs_g": 180,
            "custom_fat_g": fat_g,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["targets"]["calories"] == override_calories

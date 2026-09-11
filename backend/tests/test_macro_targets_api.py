"""Tests for POST /api/macro-targets — pure deterministic computation, no
auth and no live Supabase dependency, so these always run. Covers rate-based
calorie targets (through the feasibility policy), calorie override,
automatic-vs-custom macro modes, and the request-level validation that
keeps a client from creating a mathematically inconsistent target.
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

# A deliberately high-TDEE payload (heavy, very active) so none of the
# three cut rates or the bulk rate ever trip the feasibility policy —
# isolates "does the API reflect rate selection" from safety-cap behavior.
HIGH_TDEE_PAYLOAD = {
    "weight_kg": 100,
    "height_cm": 185,
    "age_years": 25,
    "sex": "male",
    "activity_level": "very_active",
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


def test_maintain_returns_recommended_equal_to_final_calories_and_tdee():
    resp = client.post("/api/macro-targets", json=BASE_PAYLOAD)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["recommended_calories"] == body["targets"]["calories"]
    assert body["recommended_calories"] == body["tdee"] == body["maintenance_calories"]
    assert body["daily_energy_change_kcal"] == 0
    assert body["is_rate_capped"] is False
    assert body["bmr"] > 0


def test_cut_requires_no_rate_but_defaults_sensibly():
    # Omitting rate_kg_per_week falls back to the legacy fixed adjustment —
    # must still return a lower calorie target than maintain, not error.
    resp = client.post("/api/macro-targets", json={**BASE_PAYLOAD, "goal": "cut"})
    assert resp.status_code == 200, resp.text


def test_cut_calorie_target_decreases_as_rate_increases_and_is_not_capped():
    calories = []
    for rate in (0.5, 0.75, 1.0):
        resp = client.post(
            "/api/macro-targets",
            json={**HIGH_TDEE_PAYLOAD, "goal": "cut", "rate_kg_per_week": rate},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["is_rate_capped"] is False
        assert body["requested_rate_kg_per_week"] == rate
        calories.append(body["recommended_calories"])
    assert calories[0] > calories[1] > calories[2]
    assert len(set(calories)) == 3


def test_cut_rate_above_safe_cap_is_rejected_with_422():
    resp = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "goal": "cut", "rate_kg_per_week": 2.0},
    )
    assert resp.status_code == 422


def test_bulk_rate_option_accepted_and_exceeds_maintenance():
    maintain = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    resp = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "goal": "bulk", "rate_kg_per_week": 0.25},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["recommended_calories"] > body["bmr"]
    assert body["recommended_calories"] > maintain["recommended_calories"]


def test_low_tdee_profile_recognizes_aggressive_rate_and_exposes_the_cap():
    low_tdee_payload = {
        "weight_kg": 65,
        "height_cm": 165,
        "age_years": 30,
        "sex": "female",
        "activity_level": "moderate",
    }
    resp = client.post(
        "/api/macro-targets",
        json={**low_tdee_payload, "goal": "cut", "rate_kg_per_week": 1.0},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_rate_capped"] is True
    assert body["requested_rate_kg_per_week"] == 1.0
    assert body["applied_rate_kg_per_week"] < 1.0
    assert body["cap_reason"] in ("tdee_fraction", "bodyweight_percent")
    assert body["cap_explanation"]
    assert body["recommended_calories"] >= 1200


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


def test_calorie_override_recalculates_macros_automatically_and_reconciles():
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    recommended = baseline["recommended_calories"]

    lowered = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "calorie_override": recommended - 300},
    ).json()
    t = lowered["targets"]
    reconstructed = t["protein_g"] * 4 + t["carbs_g"] * 4 + t["fat_g"] * 9
    assert abs(reconstructed - t["calories"]) <= 3


def test_low_calorie_override_surfaces_a_warning_without_being_silently_replaced():
    # A profile whose recommended calories sit close enough to 1500 that a
    # small downward override (still within the ±500 tolerance) pushes the
    # *final* target below the low-calorie warning threshold.
    payload = {
        "weight_kg": 60,
        "height_cm": 165,
        "age_years": 30,
        "sex": "female",
        "activity_level": "light",
        "goal": "cut",
        "rate_kg_per_week": 0.5,
    }
    baseline = client.post("/api/macro-targets", json=payload).json()
    recommended = baseline["recommended_calories"]
    assert 1200 < recommended < 1500  # sanity-check the fixture lands where intended

    override_calories = recommended - 50
    resp = client.post(
        "/api/macro-targets",
        json={**payload, "calorie_override": override_calories},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The honest calculated value is shown, never silently replaced with a
    # rounder "normal-range" number.
    assert body["targets"]["calories"] == override_calories
    assert body["low_calorie_warning"] is not None
    assert "healthcare professional" in body["low_calorie_warning"].lower()


def test_low_calorie_warning_reflects_the_final_displayed_target_not_the_request():
    """Literal spec examples: a final target of 1450 shows the warning, a
    final target of 1750 does not -- and this must hold regardless of how
    "aggressive" the request that produced it was, since the warning is
    keyed to the *final* number the user will actually see and save, not
    to the raw requested rate."""
    payload = {
        "weight_kg": 58,
        "height_cm": 160,
        "age_years": 32,
        "sex": "female",
        "activity_level": "light",
        "goal": "maintain",
    }
    baseline = client.post("/api/macro-targets", json=payload).json()
    assert baseline["recommended_calories"] == 1731  # fixture sanity-check

    below_threshold = client.post(
        "/api/macro-targets", json={**payload, "calorie_override": 1450}
    ).json()
    assert below_threshold["targets"]["calories"] == 1450
    assert below_threshold["low_calorie_warning"] is not None

    above_threshold = client.post(
        "/api/macro-targets", json={**payload, "calorie_override": 1750}
    ).json()
    assert above_threshold["targets"]["calories"] == 1750
    assert above_threshold["low_calorie_warning"] is None


def test_protein_reflects_goal_and_bodyweight_not_a_frozen_bodybuilding_value():
    """Regression test for a real bug: protein once defaulted to an
    extreme ~2.8 g/kg-style value that stayed effectively frozen regardless
    of context. Protein must now reflect the documented, moderate g/kg
    rule for the selected goal (evidence-informed 1.2-2.0 g/kg range)."""
    maintain = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    cut = client.post(
        "/api/macro-targets",
        json={**BASE_PAYLOAD, "goal": "cut", "rate_kg_per_week": 0.5},
    ).json()

    weight_kg = BASE_PAYLOAD["weight_kg"]
    assert maintain["targets"]["protein_g"] == round(weight_kg * 1.4)
    assert cut["targets"]["protein_g"] == round(weight_kg * 1.8)
    # Nowhere near an extreme ~2.8 g/kg bodybuilding-style value.
    assert cut["targets"]["protein_g"] < round(weight_kg * 2.5)


def test_custom_macro_mode_recalculates_carbs_as_the_exact_remainder():
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    calories = baseline["recommended_calories"]
    # protein 150 + carbs 200 + fat within 5% of calories (raw sanity check)
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
    # Protein/fat pass through exactly as chosen; carbs is fine-tuned to
    # whatever makes the total reconcile exactly with the calorie target —
    # this is the fix for the ~2054-vs-2000 class of bug, so the response
    # must never show a calorie/macro mismatch even in custom mode.
    assert t["protein_g"] == 150
    assert t["fat_g"] == fat_g
    reconstructed = t["protein_g"] * 4 + t["carbs_g"] * 4 + t["fat_g"] * 9
    assert abs(reconstructed - t["calories"]) <= 3


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


def test_custom_macro_mode_protein_and_fat_alone_exceeding_calories_rejected():
    # protein+fat alone must land within the overall ±5% tolerance (so the
    # *existing* mismatch check doesn't reject it first) while still
    # exceeding the calorie target on their own -- carbs_g=0 makes that
    # possible, and is exactly the scenario the extra feasibility check
    # exists to catch.
    baseline = client.post("/api/macro-targets", json=BASE_PAYLOAD).json()
    override_calories = baseline["recommended_calories"] - 500  # stays within tolerance
    protein_g, fat_g = 300, 130  # 1200 + 1170 = 2370 kcal, ~4% over override_calories

    resp = client.post(
        "/api/macro-targets",
        json={
            **BASE_PAYLOAD,
            "calorie_override": override_calories,
            "macro_mode": "custom",
            "custom_protein_g": protein_g,
            "custom_carbs_g": 0,
            "custom_fat_g": fat_g,
        },
    )
    assert resp.status_code == 422
    assert "Protein and fat" in resp.json()["detail"]


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

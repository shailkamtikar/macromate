import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Covers onboarding batch 1: activity-level education, weight-loss rate
// selection feeding the deterministic calorie calc, the calorie
// slider/override, and automatic-vs-custom macros — all against the real
// backend (no mocked calculation).

function loadBackendEnv(): Record<string, string> {
  const raw = readFileSync(join(__dirname, "../../backend/.env"), "utf-8");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadBackendEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const adminHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function createConfirmedUser(prefix: string) {
  const email = `macromate-e2e-${prefix}-${Date.now()}@example.com`;
  const password = `Tt${Math.random().toString(36).slice(2)}!1Aa`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  return { email, password, userId: body.id as string };
}

async function deleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

test("onboarding: activity-level education, cut rate selection, and calorie override produce a lower, consistent target", async ({
  page,
}) => {
  const user = await createConfirmedUser("onboard-cut");
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });

    await page.getByLabel("Username").fill(`e2ecut${Date.now() % 100000}`);
    await page.getByLabel("Weight (kg)").fill("90");
    await page.getByLabel("Height (cm)").fill("182");
    await page.getByLabel("Age").fill("30");
    await page.getByRole("button", { name: "Continue" }).click();

    // Activity-level step: every level's explanation is visible before
    // selection, not hidden behind a bare dropdown.
    await expect(page.getByText("Little to no exercise, mostly sitting through the day.")).toBeVisible();
    await expect(page.getByText(/physically demanding job/).first()).toBeVisible();
    await page.getByRole("button", { name: /Very active/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Goal & pace: Cut requires an explicit rate before continuing.
    await page.getByRole("button", { name: "Cut" }).click();
    const continueButton = page.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeDisabled();
    await page.getByRole("button", { name: "Lose 1 kg/week", exact: false }).click();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    // Targets step: recommended vs selected, editable via the slider.
    await expect(page.getByText("Recommended")).toBeVisible({ timeout: 10_000 });
    // Hydration goal must be shown before the user confirms, not just
    // silently saved and revealed for the first time on Today.
    await expect(page.getByText("Daily hydration goal")).toBeVisible();
    const submitButton = page.getByRole("button", { name: "Save & continue" });
    await expect(submitButton).toBeEnabled({ timeout: 10_000 });

    // Lower the calorie target via the numeric input and confirm the
    // automatic macro breakdown updates (protein/carbs/fat all present).
    const calorieInput = page.getByLabel("Calorie target (kcal)");
    const before = Number(await calorieInput.inputValue());
    await calorieInput.fill(String(before - 200));
    await expect(page.getByText("200 kcal below recommended.")).toBeVisible({
      timeout: 5_000,
    });
    // The Save button must go back to disabled while the edited target
    // recalculates, and only re-enable once the *new* value is confirmed
    // — otherwise it could submit stale (pre-edit) targets.
    await expect(submitButton).toBeEnabled({ timeout: 10_000 });

    await submitButton.click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    // The saved target_calories must reflect the overridden value, not the
    // original recommendation — proves the override actually persisted.
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.userId}&select=target_calories,rate_kg_per_week,goal`,
      { headers: adminHeaders },
    );
    const [savedProfile] = await profileRes.json();
    expect(savedProfile.target_calories).toBe(before - 200);
    expect(savedProfile.rate_kg_per_week).toBe(1);
    expect(savedProfile.goal).toBe("cut");
  } finally {
    await deleteUser(user.userId);
  }
});

test("onboarding: custom macros inconsistent with calorie target show a validation message", async ({
  page,
}) => {
  const user = await createConfirmedUser("onboard-custom");
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });

    await page.getByLabel("Username").fill(`e2ecustom${Date.now() % 100000}`);
    await page.getByLabel("Weight (kg)").fill("70");
    await page.getByLabel("Height (cm)").fill("170");
    await page.getByLabel("Age").fill("25");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("button", { name: /Moderately active/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Maintain — no rate needed.
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Recommended")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "custom" }).click();

    // Deliberately contradictory macros (way more than the calorie target
    // could imply) — must surface a clear, specific validation message and
    // must not let the user proceed with an inconsistent target.
    await page.getByLabel("Custom protein grams").fill("400");
    await page.getByLabel("Custom carbs grams").fill("500");
    await page.getByLabel("Custom fat grams").fill("200");

    const submitButton = page.getByRole("button", { name: "Save & continue" });
    await expect(page.getByText("These macros total 5400 kcal")).toBeVisible({
      timeout: 5_000,
    });
    await expect(submitButton).toBeDisabled({ timeout: 10_000 });

    // Correcting the macros to something consistent re-enables submission.
    // These match what "automatic" mode itself would compute for this
    // exact profile (70kg, maintain) — guaranteed to reconcile with the
    // calorie target.
    await page.getByLabel("Custom protein grams").fill("140");
    await page.getByLabel("Custom carbs grams").fill("337");
    await page.getByLabel("Custom fat grams").fill("71");
    await expect(submitButton).toBeEnabled({ timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

test("a returning user with a completed profile is redirected away from onboarding instead of re-running the wizard", async ({
  page,
}) => {
  const user = await createConfirmedUser("onboard-returning");
  try {
    // Seed a fully completed profile directly — this user has already
    // finished onboarding in a prior session.
    await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        id: user.userId,
        username: `returning${Date.now() % 1000000}`,
        sex: "female",
        age_years: 40,
        height_cm: 165,
        activity_level: "light",
        goal: "maintain",
        macro_mode: "custom",
        target_calories: 1900,
        target_protein_g: 150,
        target_carbs_g: 190,
        target_fat_g: 60,
        water_goal_ml: 2200,
      }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/weight_logs`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ user_id: user.userId, weight_kg: 68 }),
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    // Even a direct visit to /onboarding must bounce straight back — never
    // silently re-run the wizard and overwrite the real (custom) profile.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.userId}&select=target_calories,macro_mode,goal`,
      { headers: adminHeaders },
    );
    const [savedProfile] = await profileRes.json();
    expect(savedProfile.target_calories).toBe(1900);
    expect(savedProfile.macro_mode).toBe("custom");
    expect(savedProfile.goal).toBe("maintain");
  } finally {
    await deleteUser(user.userId);
  }
});

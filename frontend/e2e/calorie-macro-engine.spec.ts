import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Manual UI verification for the calorie/macro engine correction (review
// section 7): Maintain / cut rates / bulk / manual override / a genuinely
// aggressive low-TDEE profile's cap banner / macro-calorie arithmetic —
// all driven through the real TargetsEditor against the real backend.

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

async function createUserWithProfile(
  prefix: string,
  weightKg: number,
  profileOverrides: Record<string, unknown>,
) {
  const email = `macromate-e2e-${prefix}-${Date.now()}@example.com`;
  const password = `Tt${Math.random().toString(36).slice(2)}!1Aa`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  const userId = body.id as string;
  // weight_kg is NOT a profiles column — the user's current weight lives
  // in weight_logs (most recent entry), which ProfilePage/TargetsEditor
  // read separately. Seed both, or ProfilePage shows "enter your weight"
  // instead of ever rendering the targets editor.
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: userId,
      username: `${prefix}${Date.now() % 1000000}`,
      target_calories: 2200,
      target_protein_g: 160,
      target_carbs_g: 220,
      target_fat_g: 70,
      ...profileOverrides,
    }),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/weight_logs`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ user_id: userId, weight_kg: weightKg }),
  });
  return { email, password, userId };
}

async function deleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
}

async function readKcal(locator: import("@playwright/test").Locator): Promise<number> {
  const text = await locator.textContent();
  const match = text?.match(/-?\d[\d,]*/);
  if (!match) throw new Error(`No number found in "${text}"`);
  return Number(match[0].replace(/,/g, ""));
}

/** Waits for TargetsEditor's own debounced recalculation to fully settle
 * (it flips `loading` true synchronously on any input change, then false
 * once the real backend round-trip resolves) before reading any values —
 * deterministic, rather than polling parsed text for a change that may
 * never differ (e.g. two rates legitimately capped to the same result). */
async function waitForRecalculation(editor: import("@playwright/test").Locator) {
  // `loading` flips true synchronously when the effect's deps change,
  // before its 300ms debounce + the real fetch resolve — wait for that
  // visible state first (tolerating an already-finished, very fast round
  // trip) so a stale "not showing yet" read never gets mistaken for
  // "already settled".
  try {
    await editor.getByText("Calculating…").waitFor({ state: "visible", timeout: 1000 });
  } catch {
    // Fine — the round trip may have already finished before we checked.
  }
  await expect(editor.getByText("Calculating…")).toHaveCount(0, { timeout: 10_000 });
}

test("Maintain / cut rates / bulk each produce meaningfully different, correctly-ordered suggested intake (high-TDEE profile)", async ({
  page,
}) => {
  // Heavy + very active -> high TDEE, so none of the three cut rates need
  // capping — isolates "does rate selection work" from the safety policy.
  const user = await createUserWithProfile("engine-high", 95, {
    sex: "male",
    age_years: 25,
    height_cm: 185,
    activity_level: "very_active",
    goal: "maintain",
  });
  try {
    await login(page, user.email, user.password);

    const sidebar = page.getByTestId("app-sidebar");
    await sidebar.getByRole("button", { name: "Weight goal" }).click();
    await sidebar.getByRole("button", { name: "Edit weight & goal" }).click();
    const editor = page.getByRole("dialog", { name: "Profile & settings" });
    await expect(editor).toBeVisible();

    // A. Maintain: suggested intake equals estimated maintenance.
    const maintenance = editor.getByTestId("maintenance-calories");
    const suggested = editor.getByTestId("suggested-intake");
    await waitForRecalculation(editor);
    const maintenanceKcal = await readKcal(maintenance);
    expect(await readKcal(suggested)).toBe(maintenanceKcal);
    await expect(editor.getByTestId("rate-cap-banner")).toHaveCount(0);

    // B/C/D. Each cut rate produces a strictly lower, distinct target, and
    // none of them trip the (high-TDEE) safety policy.
    await editor.getByRole("button", { name: "Cut" }).click();
    await editor.getByRole("button", { name: "Lose 0.5 kg/week", exact: false }).click();
    await waitForRecalculation(editor);
    const half = await readKcal(suggested);
    await expect(editor.getByTestId("rate-cap-banner")).toHaveCount(0);
    expect(half).toBeLessThan(maintenanceKcal);

    await editor.getByRole("button", { name: "Lose 0.75 kg/week", exact: false }).click();
    await waitForRecalculation(editor);
    const threeQuarter = await readKcal(suggested);
    await expect(editor.getByTestId("rate-cap-banner")).toHaveCount(0);
    expect(threeQuarter).toBeLessThan(half);

    await editor.getByRole("button", { name: "Lose 1 kg/week", exact: false }).click();
    await waitForRecalculation(editor);
    const full = await readKcal(suggested);
    await expect(editor.getByTestId("rate-cap-banner")).toHaveCount(0);
    expect(full).toBeLessThan(threeQuarter);

    // E. Bulk exceeds maintenance. Goal alone resets the rate to
    // unselected, so the 0.25 kg/week option must be picked explicitly —
    // otherwise the request omits rate_kg_per_week and falls back to the
    // legacy fixed adjustment instead of exercising the rate itself.
    await editor.getByRole("button", { name: "Bulk" }).click();
    await editor.getByRole("button", { name: "Gain 0.25 kg/week", exact: false }).click();
    await waitForRecalculation(editor);
    const bulk = await readKcal(suggested);
    expect(bulk).toBeGreaterThan(maintenanceKcal);

    // The seeded profile's own saved target_calories pre-fills the editor
    // as a starting override, which — correctly, and independently of
    // this review — stays reconciled (clamped) to within tolerance of
    // whatever the *current* recommendation is as goal/rate change,
    // rather than snapping exactly to it. "Reset to recommended" clears
    // that override so the rest of this test verifies against a clean,
    // un-overridden baseline.
    const resetButton = editor.getByRole("button", { name: "Reset to recommended" });
    if (await resetButton.isVisible()) {
      await resetButton.click();
      await waitForRecalculation(editor);
    }

    // H. Displayed macro calories reconcile with the displayed target —
    // never a repeat of the ~2054-vs-2000 mismatch, visibly in the UI.
    const selectedCalories = await readKcal(editor.getByTestId("selected-calories"));
    expect(selectedCalories).toBe(bulk);
    const protein = await readKcal(editor.getByTestId("macro-protein_g"));
    const carbs = await readKcal(editor.getByTestId("macro-carbs_g"));
    const fat = await readKcal(editor.getByTestId("macro-fat_g"));
    const reconstructed = protein * 4 + carbs * 4 + fat * 9;
    expect(Math.abs(reconstructed - selectedCalories)).toBeLessThanOrEqual(5);

    // F. Manual override changes the target and the macros recalculate.
    const calorieInput = editor.getByLabel("Calorie target (kcal)");
    const overridden = selectedCalories - 200;
    await calorieInput.fill(String(overridden));
    await calorieInput.blur();
    await waitForRecalculation(editor);
    await expect(editor.getByTestId("selected-calories")).toContainText(String(overridden));
    const newProtein = await readKcal(editor.getByTestId("macro-protein_g"));
    const newCarbs = await readKcal(editor.getByTestId("macro-carbs_g"));
    const newFat = await readKcal(editor.getByTestId("macro-fat_g"));
    expect(Math.abs(newProtein * 4 + newCarbs * 4 + newFat * 9 - overridden)).toBeLessThanOrEqual(5);
  } finally {
    await deleteUser(user.userId);
  }
});

test("a genuinely aggressive rate for a low-TDEE profile shows the requested-vs-recommended cap explanation, not a silent extreme target", async ({
  page,
}) => {
  const user = await createUserWithProfile("engine-low", 65, {
    sex: "female",
    age_years: 30,
    height_cm: 165,
    activity_level: "moderate",
    goal: "cut",
    rate_kg_per_week: 1.0,
  });
  try {
    await login(page, user.email, user.password);

    const sidebar = page.getByTestId("app-sidebar");
    await sidebar.getByRole("button", { name: "Weight goal" }).click();
    await sidebar.getByRole("button", { name: "Edit weight & goal" }).click();
    const editor = page.getByRole("dialog", { name: "Profile & settings" });
    await expect(editor).toBeVisible();

    // G. The cap is explained, not hidden — with the requested rate
    // distinguished from what was actually applied, and calm, non-medical
    // wording (never "safe"/"healthy").
    const banner = editor.getByTestId("rate-cap-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Requested: Lose 1 kg/week");
    await expect(banner).toContainText("Recommended maximum:");
    await expect(banner).toContainText("larger deficit than we recommend");
    const bannerText = (await banner.textContent())?.toLowerCase() ?? "";
    expect(bannerText).not.toContain("safe");
    expect(bannerText).not.toContain("healthy");

    // Still a real, non-extreme number — never silently absurd.
    const suggested = await readKcal(editor.getByTestId("suggested-intake"));
    expect(suggested).toBeGreaterThanOrEqual(1200);
  } finally {
    await deleteUser(user.userId);
  }
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Reads backend/.env directly (never printed) to get the service-role key
// needed to pre-create a confirmed test user and seed one food item via
// the Supabase admin API — this project requires email confirmation, so a
// browser-driven signup can't complete without real email access. Every
// step from login onward is driven through the real UI against the real
// backend and database.
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

async function createConfirmedUser() {
  const email = `macromate-e2e-${Date.now()}@example.com`;
  const password = `Tt${Math.random().toString(36).slice(2)}!1Aa`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { email, password, userId: body.id as string };
}

async function deleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

async function seedFoodItem(name: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      name,
      serving_description: "1 serving",
      calories: 150,
      protein_g: 10,
      carbs_g: 15,
      fat_g: 5,
    }),
  });
  if (!res.ok) throw new Error(`seed food failed: ${res.status} ${await res.text()}`);
  return (await res.json())[0].id as string;
}

async function deleteFoodItem(id: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

test("login -> onboarding -> log food -> log water -> Today reflects it", async ({
  page,
}) => {
  const user = await createConfirmedUser();
  const foodName = `__e2e_test_food_${Date.now()}`;
  const foodId = await seedFoodItem(foodName);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();

    // Fresh user has no profile yet -> Today redirects to onboarding.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });

    await page.getByLabel("Username").fill(`e2euser${Date.now() % 100000}`);
    await page.getByLabel("Weight (kg)").fill("75");
    await page.getByLabel("Height (cm)").fill("178");
    await page.getByLabel("Age").fill("28");
    await page.getByRole("button", { name: "Save & continue" }).click();

    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
    await expect(page.getByText("Today's Balance")).toBeVisible();

    // Log the seeded food via the real search -> add flow.
    await page.getByPlaceholder("Search foods…").fill(foodName);
    const resultRow = page.getByText(foodName);
    await expect(resultRow).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: `Add ${foodName}` }).click();

    // Meal timeline should now show it, with its 150 kcal, scoped to that
    // specific row to avoid matching the "0g / 150g" macro-target text
    // that also happens to contain "150" elsewhere on the page.
    const mealRow = page.locator("li", { hasText: foodName });
    await expect(mealRow).toBeVisible({ timeout: 10_000 });
    await expect(mealRow).toContainText("150 kcal");

    // Log water via the default quick-tap button — the total must move
    // from 0 to 250, not just the (always-present) button label.
    const waterTotal = page.getByTestId("water-total");
    await expect(waterTotal).toContainText("0");
    await page.getByRole("button", { name: "+250ml" }).click();
    await expect(waterTotal).toContainText("250", { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId); // cascades profile/food_logs/weight_logs
    await deleteFoodItem(foodId);
  }
});

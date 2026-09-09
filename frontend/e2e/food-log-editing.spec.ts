import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Covers batch 2 item 1: editing/removing an already-logged food entry
// actually persists (real Supabase data) and Today's totals/remaining
// macros update immediately afterward.

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

async function createOnboardedUser() {
  const email = `macromate-e2e-foodedit-${Date.now()}@example.com`;
  const password = `Tt${Math.random().toString(36).slice(2)}!1Aa`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  const userId = body.id as string;
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: userId,
      username: `e2efoodedit${Date.now() % 100000}`,
      sex: "male",
      age_years: 28,
      height_cm: 178,
      activity_level: "moderate",
      goal: "maintain",
      target_calories: 2200,
      target_protein_g: 160,
      target_carbs_g: 220,
      target_fat_g: 70,
    }),
  });
  return { email, password, userId };
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
      calories: 200,
      protein_g: 10,
      carbs_g: 20,
      fat_g: 8,
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

test("editing a logged food's quantity recalculates its macros and Today's totals", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  const foodName = `__e2e_editfood_${Date.now()}`;
  const foodId = await seedFoodItem(foodName);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.getByPlaceholder("Search foods…").fill(foodName);
    const searchResults = page.getByTestId("food-search-results");
    await expect(searchResults).toContainText(foodName, { timeout: 10_000 });
    await searchResults.getByRole("button", { name: `Add ${foodName}` }).click();

    const mealRow = page.locator("li", { hasText: foodName });
    await expect(mealRow).toBeVisible({ timeout: 10_000 });
    await expect(mealRow).toContainText("200 kcal");

    const consumedCalories = page.getByTestId("consumed-calories");
    await expect(consumedCalories).toContainText("200");

    // Edit the quantity to 3x — calories must recompute to 600, and the
    // "Consumed" total on the calorie hero card must reflect it too.
    await mealRow.getByRole("button", { name: `Edit ${foodName}` }).click();
    const quantityInput = mealRow.getByLabel(`Quantity for ${foodName}`);
    await quantityInput.fill("3");
    await mealRow.getByRole("button", { name: `Save ${foodName}` }).click();

    await expect(mealRow).toContainText("600 kcal", { timeout: 10_000 });
    await expect(consumedCalories).toContainText("600", { timeout: 10_000 });

    // Removing it deletes the persisted log and the total drops back to 0.
    page.once("dialog", (dialog) => dialog.accept());
    await mealRow.getByRole("button", { name: `Remove ${foodName}` }).click();
    await expect(mealRow).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Nothing logged yet today")).toBeVisible();
    await expect(consumedCalories).toContainText("0", { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
    await deleteFoodItem(foodId);
  }
});

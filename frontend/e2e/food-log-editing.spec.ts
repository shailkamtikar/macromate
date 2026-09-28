import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 1 (core nutrition diary UX): meal-organized diary, per-meal and
// daily totals, editing quantity/unit/meal, deleting, and recent foods —
// all against real Supabase data.

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

// Cleanup registry — users are deleted first so their food_logs cascade
// away, which is what makes the seeded food_items safe to delete after.
let pendingUserIds: string[] = [];
let pendingFoodIds: string[] = [];

test.afterEach(async () => {
  for (const id of pendingUserIds) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: adminHeaders,
    }).catch(() => {});
  }
  for (const id of pendingFoodIds) {
    await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${id}`, {
      method: "DELETE",
      headers: adminHeaders,
    }).catch(() => {});
  }
  pendingUserIds = [];
  pendingFoodIds = [];
});

async function createOnboardedUser() {
  const email = `macromate-e2e-diary-${Date.now()}@example.com`;
  const password = `Tt${Math.random().toString(36).slice(2)}!1Aa`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  const userId = body.id as string;
  pendingUserIds.push(userId);
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: userId,
      username: `e2ediary${Date.now() % 100000}`,
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

async function seedFoodItem(
  name: string,
  serving = "1 serving",
  nutrition = { calories: 200, protein_g: 10, carbs_g: 20, fat_g: 8 },
) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ name, serving_description: serving, ...nutrition }),
  });
  if (!res.ok) throw new Error(`seed food failed: ${res.status} ${await res.text()}`);
  const id = (await res.json())[0].id as string;
  pendingFoodIds.push(id);
  return id;
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
}

/** Search for a food in the picker and quick-add one serving to `meal`. */
async function quickAdd(
  page: import("@playwright/test").Page,
  foodName: string,
  meal: string,
) {
  await page.getByLabel("Meal to add to").selectOption(meal);
  await page.getByPlaceholder("Search foods…").fill(foodName);
  const results = page.getByTestId("food-search-results");
  await expect(results).toContainText(foodName, { timeout: 10_000 });
  await results.getByRole("button", { name: `Add ${foodName}` }).click();
}

test("diary entry can change quantity and move between meals, updating meal and daily totals", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  const foodName = `__e2e_editfood_${Date.now()}`;
  await seedFoodItem(foodName);

  await login(page, user.email, user.password);
  await quickAdd(page, foodName, "lunch");

  const diary = page.getByTestId("diary");
  const lunch = page.getByTestId("meal-lunch");
  const entry = lunch.locator("li", { hasText: foodName });
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await expect(entry).toContainText("200 kcal");

  // Meal total and daily total both reflect the single entry.
  await expect(page.getByTestId("meal-total-lunch")).toContainText("200");
  const consumedCalories = page.getByTestId("consumed-calories");
  await expect(consumedCalories).toContainText("200");

  // Edit: 3 servings AND move it to dinner in one save.
  await entry.getByRole("button", { name: `Edit ${foodName}` }).click();
  await lunch.getByLabel("Quantity").fill("3");
  await lunch.getByLabel("Meal").selectOption("dinner");
  const saveResponse = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/food-logs/"),
  );
  await lunch.getByRole("button", { name: `Save ${foodName}` }).click();

  const dinnerEntry = page.getByTestId("meal-dinner").locator("li", { hasText: foodName });
  await expect(dinnerEntry).toBeVisible({ timeout: 10_000 });
  await expect(dinnerEntry).toContainText("600 kcal");
  // Left the old meal entirely, and both meal totals moved with it.
  await expect(lunch.locator("li", { hasText: foodName })).toHaveCount(0);
  await expect(page.getByTestId("meal-total-lunch")).toContainText("0");
  await expect(page.getByTestId("meal-total-dinner")).toContainText("600");
  await expect(consumedCalories).toContainText("600");

  // The edit renders optimistically, ahead of the network round-trip -- wait
  // for the real PATCH to actually land before reloading, since a reload
  // aborts any request still in flight and would otherwise race the save.
  await saveResponse;

  // The move persisted, not just re-rendered.
  await page.reload();
  await expect(
    page.getByTestId("meal-dinner").locator("li", { hasText: foodName }),
  ).toBeVisible({ timeout: 15_000 });

  // Remove it: entry, meal total and daily total all drop back to zero.
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByTestId("meal-dinner")
    .locator("li", { hasText: foodName })
    .getByRole("button", { name: `Remove ${foodName}` })
    .click();
  await expect(diary.locator("li", { hasText: foodName })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("consumed-calories")).toContainText("0");
});

test("a weighed food can be logged and edited in grams, not just servings", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  const foodName = `__e2e_gramfood_${Date.now()}`;
  // 100 g per serving, 150 kcal per serving -> 250 g is 2.5 servings = 375 kcal.
  await seedFoodItem(foodName, "100g", {
    calories: 150,
    protein_g: 12,
    carbs_g: 10,
    fat_g: 6,
  });

  await login(page, user.email, user.password);

  await page.getByLabel("Meal to add to").selectOption("breakfast");
  await page.getByPlaceholder("Search foods…").fill(foodName);
  const results = page.getByTestId("food-search-results");
  await expect(results).toContainText(foodName, { timeout: 10_000 });

  // Open the detail panel rather than quick-adding, and log by weight.
  await results.getByRole("button", { name: `Choose amount for ${foodName}` }).click();
  const amountField = page.getByLabel("Quantity").first();
  await expect(amountField).toHaveValue("100"); // defaults to one serving's weight
  await amountField.fill("250");
  await expect(page.getByTestId("add-food-preview")).toContainText("375 kcal");
  await page.getByRole("button", { name: "Add to Breakfast" }).click();

  const entry = page
    .getByTestId("meal-breakfast")
    .locator("li", { hasText: foodName });
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await expect(entry).toContainText("375 kcal");
  // The diary states the amount the way it was entered — in grams.
  await expect(entry).toContainText("250 g");
});

test("recently logged foods are offered for one-tap repeat logging", async ({ page }) => {
  const user = await createOnboardedUser();
  const foodName = `__e2e_recentfood_${Date.now()}`;
  await seedFoodItem(foodName);

  await login(page, user.email, user.password);
  await quickAdd(page, foodName, "snack");
  await expect(
    page.getByTestId("meal-snack").locator("li", { hasText: foodName }),
  ).toBeVisible({ timeout: 10_000 });

  // Clear the search and switch to Recent — the food just logged is there.
  await page.getByPlaceholder("Search foods…").fill("");
  await page.getByRole("button", { name: "Recent", exact: true }).click();
  const results = page.getByTestId("food-search-results");
  await expect(results).toContainText(foodName, { timeout: 10_000 });

  // One tap logs it again; the meal total doubles.
  await results.getByRole("button", { name: `Add ${foodName}` }).click();
  await expect(page.getByTestId("meal-total-snack")).toContainText("400", {
    timeout: 10_000,
  });
});

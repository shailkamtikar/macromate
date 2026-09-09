import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Covers a real gap found during release QA: the backend has always fully
// supported custom food creation with duplicate detection and global
// sharing (app/routers/food.py), but no UI ever called createFood() until
// this test drove development of the "Create a custom food" form on
// /today. Also proves the PRD-required behavior that custom foods are
// globally shared (discoverable by other users), not private per-user.

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

async function createOnboardedUser(prefix: string) {
  const email = `macromate-e2e-${prefix}-${Date.now()}@example.com`;
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
      username: `${prefix}${Date.now() % 1000000}`,
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

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
}

async function purgeStaleE2eCustomFoods() {
  // Self-healing: a prior run that crashed/timed out mid-test can leave a
  // "__e2e custom food <ts>" row behind despite this test's own teardown.
  // Since every such row shares that literal prefix, pg_trgm flags a new
  // one as a false-positive "duplicate" of it, breaking test isolation.
  // Sweep them before creating this run's food, not just after.
  const stale = await fetch(
    `${SUPABASE_URL}/rest/v1/food_items?name=ilike.*__e2e custom food*&select=id`,
    { headers: adminHeaders },
  );
  const rows: { id: string }[] = await stale.json();
  for (const row of rows) {
    await fetch(`${SUPABASE_URL}/rest/v1/food_logs?food_item_id=eq.${row.id}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${row.id}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
  }
}

test("user creates a custom food, a second user discovers and logs it globally, and a duplicate is flagged", async ({
  browser,
}) => {
  await purgeStaleE2eCustomFoods();
  const a = await createOnboardedUser("customfooda");
  const b = await createOnboardedUser("customfoodb");
  const foodName = `__e2e custom food ${Date.now()}`;
  let foodItemId: string | null = null;

  try {
    // --- User A creates the custom food through the real UI ---
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await login(pageA, a.email, a.password);

    await pageA.getByPlaceholder("Search foods…").fill(foodName);
    await pageA.getByRole("button", { name: "Can't find it? Create a custom food" }).click();
    await pageA.getByLabel("Custom food name").fill(foodName);
    await pageA.getByLabel("Serving description").fill("1 portion");
    await pageA.getByLabel("Calories").fill("180");
    await pageA.getByLabel("Protein grams").fill("12");
    await pageA.getByLabel("Carbs grams").fill("20");
    await pageA.getByLabel("Fat grams").fill("4");
    await pageA.getByRole("button", { name: "Create food" }).click();

    await expect(pageA.getByText(`"${foodName}" created`)).toBeVisible({ timeout: 10_000 });

    // Creating the *exact same* food again must be flagged as a likely
    // duplicate, not silently duplicated.
    await pageA.getByPlaceholder("Search foods…").fill(foodName);
    await pageA.getByRole("button", { name: "Can't find it? Create a custom food" }).click();
    await pageA.getByLabel("Custom food name").fill(foodName);
    await pageA.getByLabel("Serving description").fill("1 portion");
    await pageA.getByLabel("Calories").fill("180");
    await pageA.getByLabel("Protein grams").fill("12");
    await pageA.getByLabel("Carbs grams").fill("20");
    await pageA.getByLabel("Fat grams").fill("4");
    await pageA.getByRole("button", { name: "Create food" }).click();
    await expect(pageA.getByText("Similar foods already exist")).toBeVisible({ timeout: 10_000 });
    await contextA.close();

    // --- User B (unrelated, no relationship to A) discovers it globally ---
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await login(pageB, b.email, b.password);

    await pageB.getByPlaceholder("Search foods…").fill(foodName);
    const searchResults = pageB.getByTestId("food-search-results");
    await expect(searchResults).toContainText(foodName, { timeout: 10_000 });
    await searchResults.getByRole("button", { name: `Add ${foodName}` }).click();

    const mealRow = pageB.locator("li", { hasText: foodName });
    await expect(mealRow).toBeVisible({ timeout: 10_000 });
    await expect(mealRow).toContainText("180 kcal");
    await contextB.close();

  } finally {
    // Look up by name (not a variable only assigned on the success path) so
    // the food item created partway through this test is always cleaned up,
    // even if a later assertion fails — otherwise it lingers and gets
    // flagged as a false-positive "duplicate" of the next run's food, which
    // shares the same "__e2e custom food <timestamp>" naming scheme.
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/food_items?name=eq.${encodeURIComponent(foodName)}&select=id`,
      { headers: adminHeaders },
    );
    const rows = await lookup.json();
    foodItemId = rows[0]?.id ?? null;
    if (foodItemId) {
      await fetch(`${SUPABASE_URL}/rest/v1/food_logs?food_item_id=eq.${foodItemId}`, {
        method: "DELETE",
        headers: adminHeaders,
      });
      await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${foodItemId}`, {
        method: "DELETE",
        headers: adminHeaders,
      });
    }
    await deleteUser(a.userId);
    await deleteUser(b.userId);
  }
});

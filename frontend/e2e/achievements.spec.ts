import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

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
      target_calories: 2000,
      target_protein_g: 150,
      target_carbs_g: 200,
      target_fat_g: 65,
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

async function deleteFoodItem(foodId: string) {
  // food_items.created_by is ON DELETE SET NULL, so deleting the user alone
  // orphans this seeded row forever instead of removing it -- it would
  // otherwise leak into every user's smart-food-suggestions results. Call
  // this *after* deleteUser (which cascades away referencing food_logs,
  // avoiding the ON DELETE RESTRICT on food_item_id).
  await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${foodId}`, {
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

test("a 3-day streak logged exactly at target shows the 3-day milestone and today's macro hits on Progress, plus a streak chip on Today", async ({
  page,
}) => {
  const user = await createOnboardedUser("e2eachieve");

  const foodRes = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      name: `__e2e_achieve_food_${Date.now()}`,
      serving_description: "1 serving",
      calories: 2000,
      protein_g: 150,
      carbs_g: 200,
      fat_g: 65,
    }),
  });
  const [food] = await foodRes.json();

  const now = new Date();
  for (let daysAgo = 0; daysAgo < 3; daysAgo++) {
    const loggedAt = new Date(now);
    loggedAt.setUTCDate(loggedAt.getUTCDate() - daysAgo);
    loggedAt.setUTCHours(12, 0, 0, 0);
    await fetch(`${SUPABASE_URL}/rest/v1/food_logs`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        user_id: user.userId,
        food_item_id: food.id,
        meal_type: "lunch",
        quantity: 1,
        calories: 2000,
        protein_g: 150,
        carbs_g: 200,
        fat_g: 65,
        logged_at: loggedAt.toISOString(),
      }),
    });
  }

  try {
    await login(page, user.email, user.password);

    // Streak chip visible on Today without navigating anywhere else.
    await expect(page.getByText("3-day streak")).toBeVisible({ timeout: 10_000 });

    await page.goto("/progress");
    await expect(page.getByText("Logging streak")).toBeVisible({ timeout: 10_000 });
    const milestoneBadge = page.getByTitle("3-day streak");
    await expect(milestoneBadge).toBeVisible();
    // On target today: logged exactly at target for all four macros.
    await expect(page.getByText("On target today:")).toBeVisible();
  } finally {
    await deleteUser(user.userId);
    await deleteFoodItem(food.id);
  }
});

test("a brand-new user with no logs sees no streak chip and no false achievements", async ({ page }) => {
  const user = await createOnboardedUser("e2enoachieve");
  try {
    await login(page, user.email, user.password);
    await expect(page.getByText("streak", { exact: false })).not.toBeVisible();

    await page.goto("/progress");
    await expect(page.getByText("Logging streak")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("On target today:")).not.toBeVisible();
    // No meaningful weight-progress claim from zero weight logs.
    await expect(page.getByText("Weight down")).not.toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

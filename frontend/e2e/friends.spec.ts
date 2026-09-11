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
  const username = `${prefix}${Date.now() % 1000000}`;

  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: userId,
      username,
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

  return { email, password, userId, username };
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

test("friends page shows a real accepted friend on the leaderboard", async ({ page }) => {
  const a = await createOnboardedUser("e2efrienda");
  const b = await createOnboardedUser("e2efriendb");

  // Seed an already-accepted friendship directly (the request/accept flow
  // itself is covered by the backend's live test_friends_api.py).
  await fetch(`${SUPABASE_URL}/rest/v1/friendships`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      requester_id: a.userId,
      addressee_id: b.userId,
      status: "accepted",
    }),
  });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(a.email);
    await page.getByLabel("Password").fill(a.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/friends");
    await expect(page.getByText(a.username)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(b.username)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("(you)")).toBeVisible();
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
  }
});

test("a fresh user with no friends sees clear empty states, not errors", async ({ page }) => {
  const a = await createOnboardedUser("e2efreshfriend");
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(a.email);
    await page.getByLabel("Password").fill(a.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/friends");
    await expect(page.getByText("No friends yet")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Add friends to see how you compare.")).toBeVisible();
    // No activity section at all for a friendless user -- nothing to show.
    await expect(page.getByText("Friend activity")).not.toBeVisible();
  } finally {
    await deleteUser(a.userId);
  }
});

test("search, send, and accept a friend request through the UI, then see each other on the leaderboard", async ({
  page,
}) => {
  const a = await createOnboardedUser("e2ereqa");
  const b = await createOnboardedUser("e2ereqb");
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(a.email);
    await page.getByLabel("Password").fill(a.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/friends");
    await page.getByPlaceholder("Search by username…").fill(b.username);
    await expect(page.getByText(b.username)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(`Friend request sent to ${b.username}.`)).toBeVisible();
    await expect(page.getByText(`Pending: ${b.username}`)).toBeVisible();

    // B logs in and accepts.
    await page.goto("/login");
    await page.getByLabel("Email").fill(b.email);
    await page.getByLabel("Password").fill(b.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/friends");
    await expect(page.getByText("Requests")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(a.username)).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();

    await expect(page.getByText(a.username)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(b.username)).toBeVisible();
    await expect(page.getByText("(you)")).toBeVisible();
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
  }
});

test("friend activity groups a multi-food meal into one item and never shows calories or macros", async ({
  page,
}) => {
  const a = await createOnboardedUser("e2eactivitya");
  const b = await createOnboardedUser("e2eactivityb");

  await fetch(`${SUPABASE_URL}/rest/v1/friendships`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ requester_id: a.userId, addressee_id: b.userId, status: "accepted" }),
  });

  const foodRes = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      name: `__e2e_activity_food_${Date.now()}`,
      serving_description: "1 serving",
      calories: 1234,
      protein_g: 56,
      carbs_g: 78,
      fat_g: 9,
    }),
  });
  const [food] = await foodRes.json();

  const now = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    await fetch(`${SUPABASE_URL}/rest/v1/food_logs`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        user_id: b.userId,
        food_item_id: food.id,
        meal_type: "lunch",
        quantity: 1,
        calories: 1234,
        protein_g: 56,
        carbs_g: 78,
        fat_g: 9,
        logged_at: now,
      }),
    });
  }

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(a.email);
    await page.getByLabel("Password").fill(a.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/friends");
    const activityLine = page.getByText(`${b.username} added Lunch`);
    await expect(activityLine).toBeVisible({ timeout: 10_000 });
    // Exactly one grouped item, not three.
    await expect(page.getByText(`${b.username} added Lunch`)).toHaveCount(1);

    // The distinctive seeded nutrition numbers must never appear anywhere
    // on the page.
    await expect(page.getByText("1234")).toHaveCount(0);
    await expect(page.getByText("56g")).toHaveCount(0);
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
    await deleteFoodItem(food.id);
  }
});

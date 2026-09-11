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
const API_URL = "http://localhost:8000";
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
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: adminHeaders });
}

async function deleteFoodItem(foodId: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${foodId}`, { method: "DELETE", headers: adminHeaders });
}

async function accessTokenFor(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).access_token as string;
}

async function putNotificationSettings(token: string, settings: Record<string, unknown>) {
  await fetch(`${API_URL}/api/notification-settings`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      notifications_enabled: true,
      logging_reminders_enabled: true,
      reminder_times: [],
      streak_warnings_enabled: true,
      macro_nudges_enabled: true,
      friend_activity_enabled: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
      ...settings,
    }),
  });
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
}

async function seedFriendMealActivity(
  requesterId: string,
  addresseeId: string,
  activityUserId: string,
  foodCount: number,
) {
  await fetch(`${SUPABASE_URL}/rest/v1/friendships`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ requester_id: requesterId, addressee_id: addresseeId, status: "accepted" }),
  });
  const foodRes = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      name: `__e2e_notif_food_${Date.now()}`,
      serving_description: "1 serving",
      calories: 999,
      protein_g: 88,
      carbs_g: 77,
      fat_g: 6,
    }),
  });
  const [food] = await foodRes.json();
  const now = new Date().toISOString();
  for (let i = 0; i < foodCount; i++) {
    await fetch(`${SUPABASE_URL}/rest/v1/food_logs`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        user_id: activityUserId,
        food_item_id: food.id,
        meal_type: "dinner",
        quantity: 1,
        calories: 999,
        protein_g: 88,
        carbs_g: 77,
        fat_g: 6,
        logged_at: now,
      }),
    });
  }
  return food.id as string;
}

test("notification settings persist across reload, including the new categories and reminder time", async ({
  page,
}) => {
  const user = await createOnboardedUser("e2enotifsettings");
  try {
    await login(page, user.email, user.password);
    await page.goto("/profile");

    await page.getByRole("checkbox", { name: "Friend meal activity" }).uncheck();
    await page.getByRole("checkbox", { name: "Streak-at-risk warnings" }).uncheck();
    await page.locator('input[type="time"]').first().fill("07:45");
    await page.getByRole("button", { name: "Save notification preferences" }).click();
    await expect(page.getByText("Notification preferences saved.")).toBeVisible({ timeout: 5000 });

    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Friend meal activity" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Streak-at-risk warnings" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Macro-close-to-goal nudges" })).toBeChecked();
    await expect(page.locator('input[type="time"]').first()).toHaveValue("07:45:00");
  } finally {
    await deleteUser(user.userId);
  }
});

test("the master notifications toggle persists and turning it off is reflected on reload", async ({ page }) => {
  const user = await createOnboardedUser("e2enotifmaster");
  try {
    await login(page, user.email, user.password);
    await page.goto("/profile");

    await page.getByRole("checkbox", { name: "All notifications" }).uncheck();
    await page.getByRole("button", { name: "Save notification preferences" }).click();
    await expect(page.getByText("Notification preferences saved.")).toBeVisible({ timeout: 5000 });

    await page.reload();
    await expect(page.getByRole("checkbox", { name: "All notifications" })).not.toBeChecked();
  } finally {
    await deleteUser(user.userId);
  }
});

test("a friend's meal activity shows one plain notification with no calories, macros, or food names", async ({
  page,
}) => {
  const a = await createOnboardedUser("e2enotifactivitya");
  const b = await createOnboardedUser("e2enotifactivityb");
  const foodId = await seedFriendMealActivity(a.userId, b.userId, b.userId, 3);

  try {
    await login(page, a.email, a.password);

    const banner = page.getByTestId("notification-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText(`${b.username} added`);
    await expect(banner).toContainText("Dinner");
    await expect(banner).toContainText("🍽");

    // Exactly one banner for three foods in the same meal, and it must
    // never leak the seeded distinctive nutrition numbers or food name.
    await expect(page.getByText("999")).toHaveCount(0);
    await expect(page.getByText("88g")).toHaveCount(0);
    await expect(page.getByText("__e2e_notif_food_", { exact: false })).toHaveCount(0);
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
    await deleteFoodItem(foodId);
  }
});

test("disabling the friend-activity category suppresses the notification even when real activity exists", async ({
  page,
}) => {
  const a = await createOnboardedUser("e2enotifoffa");
  const b = await createOnboardedUser("e2enotifoffb");
  const foodId = await seedFriendMealActivity(a.userId, b.userId, b.userId, 1);

  try {
    const tokenA = await accessTokenFor(a.email, a.password);
    await putNotificationSettings(tokenA, { friend_activity_enabled: false });

    await login(page, a.email, a.password);
    // Give the poller its immediate on-mount cycle a fair chance, then
    // assert the banner never appears.
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("notification-banner")).toHaveCount(0);
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
    await deleteFoodItem(foodId);
  }
});

test("the master switch off suppresses every notification, including friend activity", async ({ page }) => {
  const a = await createOnboardedUser("e2enotifmasteroffa");
  const b = await createOnboardedUser("e2enotifmasteroffb");
  const foodId = await seedFriendMealActivity(a.userId, b.userId, b.userId, 1);

  try {
    const tokenA = await accessTokenFor(a.email, a.password);
    await putNotificationSettings(tokenA, { notifications_enabled: false });

    await login(page, a.email, a.password);
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("notification-banner")).toHaveCount(0);
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
    await deleteFoodItem(foodId);
  }
});

test("a friend's activity never notifies a user who isn't their accepted friend", async ({ page }) => {
  const a = await createOnboardedUser("e2enotifprivacya");
  const stranger = await createOnboardedUser("e2enotifprivacys");
  // Seed activity for `stranger` logged by themself with no friendship to `a`.
  const foodRes = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      name: `__e2e_notif_privacy_${Date.now()}`,
      serving_description: "1 serving",
      calories: 400,
      protein_g: 30,
      carbs_g: 20,
      fat_g: 10,
    }),
  });
  const [food] = await foodRes.json();
  await fetch(`${SUPABASE_URL}/rest/v1/food_logs`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      user_id: stranger.userId,
      food_item_id: food.id,
      meal_type: "breakfast",
      quantity: 1,
      calories: 400,
      protein_g: 30,
      carbs_g: 20,
      fat_g: 10,
      logged_at: new Date().toISOString(),
    }),
  });

  try {
    await login(page, a.email, a.password);
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("notification-banner")).toHaveCount(0);
  } finally {
    await deleteUser(a.userId);
    await deleteUser(stranger.userId);
    await deleteFoodItem(food.id);
  }
});

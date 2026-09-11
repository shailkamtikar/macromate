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

async function createOnboardedUser() {
  const email = `macromate-e2e-water-${Date.now()}@example.com`;
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
      username: `e2ewater${Date.now() % 100000}`,
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

test("custom glass size can be added on Profile and logged from Today", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/profile");
    await page.getByLabel("Label").fill("Big bottle");
    await page.getByLabel("ml").fill("1000");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Big bottle (1000ml)")).toBeVisible({ timeout: 10_000 });

    await page.goto("/today");
    const waterTotal = page.getByTestId("water-total");
    await expect(waterTotal).toContainText("0");
    await page.getByRole("button", { name: "+1000ml" }).click();
    await expect(waterTotal).toContainText("1000", { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

test("water glass +/- controls add, undo, and never go below zero", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    const waterTotal = page.getByTestId("water-total");
    await expect(waterTotal).toContainText("0");

    // No glass sizes configured -> the default 250ml unit's "+" sits on
    // the very first (empty) glass.
    const addGlass = page.getByRole("button", { name: "Add one 250ml glass" });
    const removeGlass = page.getByRole("button", { name: "Remove one 250ml glass" });

    // 0 logged: nothing to subtract yet.
    await expect(removeGlass).toHaveCount(0);

    await addGlass.click();
    await expect(waterTotal).toContainText("250", { timeout: 10_000 });
    await expect(page.getByText("1 of")).toBeVisible();

    // The glass just filled now carries the "−" undo control.
    await expect(removeGlass).toBeVisible();
    await removeGlass.click();
    await expect(waterTotal).toContainText("0", { timeout: 10_000 });

    // Back to zero: the remove control disappears again rather than
    // letting the user subtract into negative territory.
    await expect(removeGlass).toHaveCount(0);

    // Add two, then confirm the reduction persists through a reload —
    // not just an in-memory React update.
    await addGlass.click();
    await expect(waterTotal).toContainText("250", { timeout: 10_000 });
    await page.reload();
    await expect(page.getByTestId("water-total")).toContainText("250", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Remove one 250ml glass" })).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("water glass -/+ controls use a custom configured glass size", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    // Configure a single, smaller custom container (100ml) — it becomes
    // "the glass" the +/- controls act on.
    await page.goto("/profile");
    await page.getByLabel("Label").fill("Small cup");
    await page.getByLabel("ml").fill("100");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Small cup (100ml)")).toBeVisible({ timeout: 10_000 });

    await page.goto("/today");
    const waterTotal = page.getByTestId("water-total");
    await expect(waterTotal).toContainText("0");

    const addGlass = page.getByRole("button", { name: "Add one 100ml glass" });
    await addGlass.click();
    await expect(waterTotal).toContainText("100", { timeout: 10_000 });

    const removeGlass = page.getByRole("button", { name: "Remove one 100ml glass" });
    await removeGlass.click();
    await expect(waterTotal).toContainText("0", { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

test("progress page renders real weekly data with no goal-hit logs yet", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/progress");
    await expect(page.getByText("Macro adherence")).toBeVisible({ timeout: 10_000 });
    // Fresh user, nothing logged this week -> "0 / N days logged", not an error page.
    await expect(page.getByText("days logged")).toBeVisible();
    await expect(page.getByText("Logging streak")).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("weekly report reflects a real logged day and shows partial-week framing with no prior-week data", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  let food: { id: string } | undefined;
  try {
    const foodRes = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
      method: "POST",
      headers: { ...adminHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        name: `__e2e_progress_food_${Date.now()}`,
        serving_description: "1 serving",
        calories: 2200,
        protein_g: 160,
        carbs_g: 220,
        fat_g: 70,
      }),
    });
    [food] = await foodRes.json();
    if (!food) throw new Error("seed food failed");

    const loggedAt = new Date();
    loggedAt.setUTCHours(12, 0, 0, 0);
    await fetch(`${SUPABASE_URL}/rest/v1/food_logs`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        user_id: user.userId,
        food_item_id: food.id,
        meal_type: "lunch",
        quantity: 1,
        calories: 2200,
        protein_g: 160,
        carbs_g: 220,
        fat_g: 70,
        logged_at: loggedAt.toISOString(),
      }),
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/progress");
    await expect(page.getByText("Macro adherence")).toBeVisible({ timeout: 10_000 });
    // Today's own log counts toward "days logged", against however many
    // days of the current week have elapsed so far -- never a full "/7"
    // for a week that isn't over yet.
    await expect(page.getByText(/1\s*\/\s*\d+\s*days logged/)).toBeVisible();
    // A brand-new user has nothing logged last week -- the comparison
    // section must say so rather than rendering a misleading comparison.
    await expect(page.getByText("No data logged last week")).toBeVisible();
  } finally {
    await deleteUser(user.userId);
    if (food) await deleteFoodItem(food.id);
  }
});

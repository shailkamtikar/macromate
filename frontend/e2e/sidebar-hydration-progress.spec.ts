import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Covers batch 2 items 3 (hydration glasses), 4 (persistent settings
// sidebar), 6 (numeric input behavior), and 7 (progress weight graph +
// activity history).

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
      username: `e2e${prefix}${Date.now() % 100000}`,
      sex: "male",
      age_years: 28,
      height_cm: 178,
      activity_level: "moderate",
      goal: "maintain",
      target_calories: 2200,
      target_protein_g: 160,
      target_carbs_g: 220,
      target_fat_g: 70,
      water_goal_ml: 2000,
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

test("hydration renders as glasses sized to the user's configured glass, filling from empty to full", async ({
  page,
}) => {
  const user = await createOnboardedUser("glasses");
  try {
    await login(page, user.email, user.password);

    // Default glass is 250ml — 0ml means every glass empty.
    const glasses = page.getByTestId("water-glasses");
    await expect(glasses).toBeVisible();
    const initialCount = await glasses.locator("svg").count();
    expect(initialCount).toBeGreaterThan(0);

    // +250ml -> exactly one full glass's worth logged.
    await page.getByRole("button", { name: "+250ml" }).click();
    await expect(page.getByTestId("water-total")).toContainText("250", { timeout: 10_000 });

    // +500ml more -> total 750ml -> 3 glasses' worth at 250ml/glass.
    await page.getByRole("button", { name: "+500ml" }).click();
    await expect(page.getByTestId("water-total")).toContainText("750", { timeout: 10_000 });

    // Visualization must not be a plain generic bar as the primary
    // element — it's a row of individual glass SVGs.
    const glassCountAfter = await glasses.locator("svg").count();
    expect(glassCountAfter).toBeGreaterThanOrEqual(3);
  } finally {
    await deleteUser(user.userId);
  }
});

test("profile/settings sidebar opens from a non-Today screen and reuses the real Profile content", async ({
  page,
}) => {
  const user = await createOnboardedUser("sidebar");
  try {
    await login(page, user.email, user.password);

    // Navigate away from Today first — the trigger must still be there.
    await page.goto("/progress");
    await expect(page.getByText("Adherence")).toBeVisible({ timeout: 10_000 });

    const trigger = page.getByRole("button", { name: "Profile & settings" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.getByRole("dialog", { name: "Profile & settings" });
    await expect(panel).toBeVisible();
    // Real profile content (weight/activity/goal/targets), not a
    // duplicated mini settings form.
    await expect(panel.getByLabel("Current weight (kg)")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Log out" })).toBeVisible();

    // Still on /progress underneath — opening the panel doesn't navigate.
    await expect(page).toHaveURL(/\/progress/);

    await page.getByRole("button", { name: "Close profile & settings" }).click();
    await expect(panel).not.toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("numeric fields don't show an unwanted zero when cleared and don't reformat while typing", async ({
  page,
}) => {
  const user = await createOnboardedUser("numeric");
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    // This user already has a profile -> Today, not onboarding. Use the
    // sidebar's embedded Profile form, which has the same weight field.
    await page.getByRole("button", { name: "Profile & settings" }).click();
    const weightInput = page.getByLabel("Current weight (kg)");
    await expect(weightInput).toBeVisible();

    await weightInput.fill("");
    await expect(weightInput).toHaveValue("");

    await weightInput.pressSequentially("102", { delay: 30 });
    await expect(weightInput).toHaveValue("102");
  } finally {
    await deleteUser(user.userId);
  }
});

test("progress page shows a real weight trend graph and today's already-recorded activity", async ({
  page,
}) => {
  const user = await createOnboardedUser("weighthist");
  const now = Date.now();
  await fetch(`${SUPABASE_URL}/rest/v1/weight_logs`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify([
      { user_id: user.userId, weight_kg: 82, logged_at: new Date(now - 6 * 86400_000).toISOString() },
      { user_id: user.userId, weight_kg: 80.5, logged_at: new Date(now - 1 * 86400_000).toISOString() },
    ]),
  });
  const today = new Date(now).toISOString().slice(0, 10);
  await fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      user_id: user.userId,
      source: "manual",
      activity_date: today,
      steps: 4321,
      workout_minutes: 15,
    }),
  });

  try {
    await login(page, user.email, user.password);
    await page.goto("/progress");

    // Real persisted weight history renders as a graph, not "—".
    await expect(page.getByText("Weight history")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("80.5kg")).toBeVisible();

    // Today's already-recorded activity must show the real numbers, not a
    // blank form as if nothing had been logged.
    await expect(page.getByText(/Recorded today: 4321 steps/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Steps")).toHaveValue("4321");
    await expect(page.getByLabel("Workout (min)")).toHaveValue("15");
  } finally {
    await deleteUser(user.userId);
  }
});

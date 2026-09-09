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
  const email = `macromate-e2e-ai-${Date.now()}@example.com`;
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
      username: `e2eai${Date.now() % 100000}`,
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

async function seedFood(name: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      name,
      serving_description: "100g",
      calories: 200,
      protein_g: 15,
      carbs_g: 10,
      fat_g: 8,
    }),
  });
  return (await res.json())[0].id as string;
}

async function deleteFood(id: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${id}`, {
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

test("Calculate with AI resolves a seeded food and logs it", async ({ page }) => {
  const user = await createOnboardedUser();
  // Must be a name Gemini's parser will actually recognize as a real food
  // (it correctly returns [] for gibberish, per its own instructions) —
  // a real food word with a short alphabetic suffix, not a long numeric
  // one (which occasionally confuses the parser into treating it as part
  // of the quantity rather than the name).
  const suffix = Math.random().toString(36).slice(2, 8);
  const foodName = `Lentil Dal Zx${suffix}`;
  const foodId = await seedFood(foodName);

  try {
    await login(page, user.email, user.password);
    await page.goto("/calculate");

    await page.getByPlaceholder("What did you eat?").fill(`1 serving of ${foodName}`);
    await page.getByRole("button", { name: "Calculate" }).click();

    await expect(page.getByText(foodName)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Add to log" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Add to log" }).first().click();
    await expect(page.getByText("Logged ✓")).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
    await deleteFood(foodId);
  }
});

test("Coach answers a fast-path question deterministically", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await login(page, user.email, user.password);
    await page.goto("/coach");

    await page.getByPlaceholder("Ask the coach…").fill("What's my BMI?");
    await page.getByRole("button", { name: "Send" }).click();

    // Fast-path answers are instant and deterministic — no Gemini call.
    await expect(page.getByText(/BMI is/i)).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

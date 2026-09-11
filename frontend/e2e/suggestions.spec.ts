import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 1B: the "What to eat next" (formerly "watch left") suggestions
// card must reflect the authenticated user's real remaining macro state,
// re-rank away from protein once the protein target is actually met, and
// refresh after every diary edit — never a static/frozen card.

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

let pendingUserIds: string[] = [];
let pendingFoodIds: string[] = [];

test.afterEach(async () => {
  // Users first: deleting the user cascades away their food_logs, which is
  // what makes deleting the seeded food_items (ON DELETE RESTRICT) safe.
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
  const email = `macromate-e2e-suggest-${Date.now()}@example.com`;
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
      username: `e2esuggest${Date.now() % 100000}`,
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
  nutrition: { calories: number; protein_g: number; carbs_g: number; fat_g: number },
  // Suggestions now require legitimate provenance (verified or owned by a
  // real user) -- default to verified so ordinary seeded test foods remain
  // eligible, exactly like a real curated/global food would be. Callers
  // testing the *exclusion* path (e.g. an AI-estimate or unowned food)
  // override this explicitly.
  extra: Record<string, unknown> = { verified: true },
) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ name, serving_description: "1 serving", ...nutrition, ...extra }),
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

test("suggestions explain themselves and prioritize protein while a real gap exists", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  const foodName = `__e2e_suggest_protein_${Date.now()}`;
  await seedFoodItem(foodName, { calories: 150, protein_g: 30, carbs_g: 2, fat_g: 3 });

  await login(page, user.email, user.password);

  const card = page.getByTestId("suggestions-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("What to eat next");
  // Nothing logged yet -> the full protein target is still a real gap.
  await expect(card).toContainText("protein still needed");
  await expect(page.getByTestId("suggestions-message")).toContainText(foodName, {
    timeout: 10_000,
  });
});

test("suggestions stop pushing protein once the day's target is already met, and refresh after diary edits", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  const fillerName = `__e2e_suggest_filler_${Date.now()}`;
  // Meets the full 160g protein target in one log, leaving calories left.
  await seedFoodItem(fillerName, { calories: 600, protein_g: 160, carbs_g: 0, fat_g: 0 });

  await login(page, user.email, user.password);

  const card = page.getByTestId("suggestions-card");
  await expect(card).toContainText("protein still needed", { timeout: 10_000 });

  // Log the filler food through the real add flow.
  await page.getByPlaceholder("Search foods…").fill(fillerName);
  const results = page.getByTestId("food-search-results");
  await expect(results).toContainText(fillerName, { timeout: 10_000 });
  await results.getByRole("button", { name: `Add ${fillerName}` }).click();

  await expect(page.getByTestId("diary").locator("li", { hasText: fillerName })).toBeVisible({
    timeout: 10_000,
  });

  // Suggestions must have refreshed off the back of that log, not stayed
  // frozen on the pre-log state.
  await expect(card).toContainText("protein goal on track", { timeout: 10_000 });
  await expect(card).not.toContainText("protein still needed");

  // Deleting the entry again flips the state back — proves suggestions
  // track live diary edits both ways, not just the add path.
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByTestId("diary")
    .locator("li", { hasText: fillerName })
    .getByRole("button", { name: `Remove ${fillerName}` })
    .click();
  await expect(page.getByTestId("diary").locator("li", { hasText: fillerName })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(card).toContainText("protein still needed", { timeout: 10_000 });
});

test("a personal AI-estimate food is never rendered as a smart suggestion", async ({ page }) => {
  // Regression test: a one-off AI-estimate food_items row (tiny per-gram
  // serving, near-zero nutrition after rounding, and a raw/garbled name)
  // must never leak into "What to eat next" for any user -- it fits any
  // remaining calorie budget trivially, so without a backend exclusion it
  // would otherwise dominate suggestions.
  const user = await createOnboardedUser();
  const junkName = `Zorbnak${Date.now()}garbageestimate`;
  await seedFoodItem(
    junkName,
    { calories: 0.9, protein_g: 0.1, carbs_g: 0.1, fat_g: 0.1 },
    { is_ai_estimate: true },
  );
  const realName = `__e2e_suggest_real_${Date.now()}`;
  await seedFoodItem(realName, { calories: 150, protein_g: 30, carbs_g: 2, fat_g: 3 });

  await login(page, user.email, user.password);

  const card = page.getByTestId("suggestions-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("suggestions-message")).toContainText(realName, {
    timeout: 10_000,
  });
  await expect(card).not.toContainText(junkName);
  await expect(card.getByRole("button", { name: `Add ${junkName}` })).toHaveCount(0);
});

test("a large remaining gap still shows real suggestions, not an empty state, and Add logs the right food", async ({
  page,
}) => {
  // Regression test for "2080 kcal / 182g protein remaining -> nothing
  // fits": a food far smaller than the full, untouched remaining budget
  // (250 kcal vs. the full 2200 kcal target) must still be suggested --
  // Smart Suggestions must never require a single food to fill the whole
  // remaining gap.
  const user = await createOnboardedUser();
  const modestName = `__e2e_suggest_modest_${Date.now()}`;
  await seedFoodItem(modestName, { calories: 250, protein_g: 47, carbs_g: 0, fat_g: 5 });

  await login(page, user.email, user.password);

  const card = page.getByTestId("suggestions-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  const message = page.getByTestId("suggestions-message");
  await expect(message).toContainText(modestName, { timeout: 10_000 });
  // The old mechanical "nothing in the food database fits" empty-state
  // copy must never appear when real suggestions exist.
  await expect(message).not.toContainText("fits that budget");

  await card.getByRole("button", { name: `Add ${modestName}` }).click();
  await expect(page.getByTestId("diary").locator("li", { hasText: modestName })).toBeVisible({
    timeout: 10_000,
  });
});

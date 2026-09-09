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

// Cleanup registry: IDs are pushed here the instant a resource is created,
// before any slow/flaky step (Gemini calls) runs. A plain try/finally
// *inside* the test body raced the test's own timeout — when a Gemini call
// hung and the whole test got hard-killed at 30s, the finally block's
// network deletes sometimes never completed, leaking seeded food_items
// rows into the shared, production-visible foods table (confirmed live:
// leftover "Lentil Dal Zx<suffix>" rows were surfacing in real users'
// "what's left" suggestions). afterEach runs as its own phase with its own
// timeout budget even after a test times out, so it's a reliable backstop
// try/finally in the test body isn't.
let pendingUserIds: string[] = [];
let pendingFoodIds: string[] = [];

test.afterEach(async () => {
  // Users first: a successfully-logged food leaves a food_logs row
  // referencing food_item_id with ON DELETE RESTRICT, so deleting the food
  // item first fails with an FK violation — silently, since fetch()
  // doesn't reject on a non-2xx response, so `.catch()` never sees it. The
  // FK violation was itself the second, undiscovered leak mechanism (the
  // first was the timeout race the comment above describes). Deleting the
  // user first cascades their food_logs rows away, so the food item is
  // always safe to delete afterward.
  for (const id of pendingUserIds) {
    await deleteUser(id).catch(() => {});
  }
  for (const id of pendingFoodIds) {
    await deleteFood(id).catch(() => {});
  }
  pendingFoodIds = [];
  pendingUserIds = [];
});

test("Calculate with AI resolves a seeded food and logs it", async ({ page }) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);
  // Must be a name Gemini's parser will actually recognize as a real food
  // (it correctly returns [] for gibberish, per its own instructions) —
  // a real food word with a short alphabetic suffix, not a long numeric
  // one (which occasionally confuses the parser into treating it as part
  // of the quantity rather than the name).
  const suffix = Math.random().toString(36).slice(2, 8);
  const foodName = `Lentil Dal Zx${suffix}`;
  const foodId = await seedFood(foodName);
  pendingFoodIds.push(foodId);

  await login(page, user.email, user.password);
  await page.goto("/calculate");

  await page.getByPlaceholder("What did you eat?").fill(`1 serving of ${foodName}`);
  await page.getByRole("button", { name: "Calculate" }).click();

  // Wait on "Add to log" itself (proof the item actually *resolved*),
  // not just foodName appearing anywhere — the raw phrase we typed is
  // echoed back verbatim even for an unresolved item, so a plain text
  // match on foodName would pass before resolution/rendering finishes.
  await expect(page.getByRole("button", { name: "Add to log" }).first()).toBeVisible({
    timeout: 30_000,
  });

  // Edit the AI-calculated quantity before logging (seeded food is 200
  // kcal/serving) — the per-item calorie display and the aggregate Total
  // below it must both recompute from the edited quantity, not silently
  // keep showing Gemini's original 1-serving numbers.
  const quantityInput = page.getByLabel("Quantity (x servings):");
  await quantityInput.fill("2");
  await expect(page.getByText("400", { exact: false }).first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/Total:\s*400 kcal/)).toBeVisible();

  await page.getByRole("button", { name: "Add to log" }).first().click();
  await expect(page.getByText("Logged ✓")).toBeVisible({ timeout: 10_000 });

  // The logged entry on Today must reflect the edited quantity (400
  // kcal), not the AI's original 1-serving parse (200 kcal).
  await page.goto("/today");
  const mealRow = page.locator("li", { hasText: foodName });
  await expect(mealRow).toBeVisible({ timeout: 10_000 });
  await expect(mealRow).toContainText("400 kcal");
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

test("Coach answers an open-ended question via real Gemini with real user context", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  try {
    await login(page, user.email, user.password);
    await page.goto("/coach");

    // Not one of the deterministic fast-path patterns (protein-left, BMI,
    // maintenance calories, calories-left) — must actually round-trip
    // through Gemini using the real injected profile/macro context.
    await page.getByPlaceholder("Ask the coach…").fill(
      "In one short sentence, is oatmeal a good breakfast for hitting a protein goal?",
    );
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Coach is thinking…")).toBeVisible();
    // The user's own message plus a real generated reply — not empty, not
    // an error, and long enough to be an actual sentence rather than a
    // stub/placeholder string.
    const replyBubble = page.locator("div.bg-surface-container-lowest").last();
    await expect(replyBubble).toBeVisible({ timeout: 30_000 });
    const replyText = await replyBubble.textContent();
    expect((replyText ?? "").length).toBeGreaterThan(15);
  } finally {
    await deleteUser(user.userId);
  }
});

test("AI food calculator gracefully handles ambiguous/unrecognizable input", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  try {
    await login(page, user.email, user.password);
    await page.goto("/calculate");

    // Gibberish, not a real food — the parser must not crash or fabricate
    // a match; it should come back unresolved with a graceful fallback
    // message pointing to manual search / custom food creation.
    await page.getByPlaceholder("What did you eat?").fill("zzqxflurbnoxious 42");
    await page.getByRole("button", { name: "Calculate" }).click();

    // Gemini may either recognize zero food-like phrases at all (empty
    // items list) or parse one phrase but fail to match it to any food in
    // the database (resolved: false) — both are correct, graceful
    // handling of unrecognizable input, so accept either message.
    await expect(
      page
        .getByText("Couldn't recognize any food in that description.")
        .or(page.getByText("Couldn't confidently match this to a food in the database.")),
    ).toBeVisible({ timeout: 30_000 });
    // No "Add to log" button should appear for unresolved/absent items.
    await expect(page.getByRole("button", { name: "Add to log" })).toHaveCount(0);
  } finally {
    await deleteUser(user.userId);
  }
});

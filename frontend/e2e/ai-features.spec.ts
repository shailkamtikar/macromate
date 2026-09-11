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

async function seedFood(name: string, servingDescription = "100g") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      name,
      serving_description: servingDescription,
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

test("Calculate with AI resolves a seeded food, lets the amount be edited, and logs it exactly like the normal picker", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);
  // Must be a name Gemini's parser will actually recognize as a real food
  // (it correctly returns [] for gibberish, per its own instructions) —
  // a real food word with a short alphabetic suffix, not a long numeric
  // one (which occasionally confuses the parser into treating it as part
  // of the quantity rather than the name).
  const suffix = Math.random().toString(36).slice(2, 8);
  const foodName = `Lentil Dal Zx${suffix}`;
  const foodId = await seedFood(foodName, "100g");
  pendingFoodIds.push(foodId);

  await login(page, user.email, user.password);
  await page.goto("/calculate?meal=lunch");

  await page.getByPlaceholder("What did you eat?").fill(`1 serving of ${foodName}`);
  await page.getByRole("button", { name: "Calculate" }).click();

  // Wait on the review card actually resolving (its amount field appears),
  // not just foodName appearing anywhere — the raw phrase we typed is
  // echoed back verbatim even for an unresolved item.
  const amountInput = page.getByLabel(`Amount for ${foodName}`);
  await expect(amountInput).toBeVisible({ timeout: 30_000 });

  // Edit the amount before logging (seeded food is 200 kcal/100g serving,
  // 200 kcal/serving) — the per-item calorie display and the aggregate
  // Total below it must both recompute from the edited amount, not
  // silently keep showing the original 1-serving numbers.
  await amountInput.fill("2");
  await expect(page.getByText(/Total:\s*400 kcal/)).toBeVisible({ timeout: 5_000 });

  const confirmButton = page.getByRole("button", { name: "Add 1 food to Lunch" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByText("Added 1 food to Lunch.")).toBeVisible({ timeout: 10_000 });
  // Duplicate-submission protection: the confirm button disappears once
  // everything in it has been logged, so a second click isn't possible.
  await expect(page.getByRole("button", { name: /Add .* food/ })).toHaveCount(0);

  // The logged entry on Today must reflect the edited amount (400 kcal),
  // land in the meal the calculator was launched for (Lunch, via the
  // ?meal= query param), and behave exactly like a normally-logged food.
  await page.goto("/today");
  const mealRow = page.getByTestId("meal-lunch").locator("li", { hasText: foodName });
  await expect(mealRow).toBeVisible({ timeout: 10_000 });
  await expect(mealRow).toContainText("400 kcal");
});

test("AI calculator surfaces ambiguous matches and lets the user choose instead of silently guessing", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);
  const suffix = Math.random().toString(36).slice(2, 8);
  const foodName = `Paneer Curry Zx${suffix}`;
  const foodIdA = await seedFood(foodName, "1 bowl (150g)");
  const foodIdB = await seedFood(foodName, "1 cup (200g)");
  pendingFoodIds.push(foodIdA, foodIdB);

  await login(page, user.email, user.password);
  await page.goto("/calculate");

  await page.getByPlaceholder("What did you eat?").fill(`some ${foodName}`);
  await page.getByRole("button", { name: "Calculate" }).click();

  await expect(page.getByText("Which did you mean?")).toBeVisible({ timeout: 30_000 });
  // Scope to the candidate buttons specifically (each shows "... kcal") —
  // a plain name match would also catch the row's own "Remove" button,
  // whose accessible name also embeds the raw phrase.
  const options = page.getByRole("button", { name: new RegExp(foodName) }).filter({
    hasText: "kcal",
  });
  await expect(options).toHaveCount(2);

  // Choosing one resolves the item deterministically from that candidate's
  // own real nutrition, not a guess — the amount field then appears.
  await options.first().click();
  await expect(page.getByLabel(`Amount for ${foodName}`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Which did you mean?")).toHaveCount(0);
});

test("resolving an AI-estimated item via search returns it to the review batch instead of logging immediately, and removing one without resolving logs nothing", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);
  const suffix = Math.random().toString(36).slice(2, 8);
  const replacementName = `Quornflitch Replacement Zx${suffix}`;
  const replacementId = await seedFood(replacementName, "1 bowl (180g)");
  pendingFoodIds.push(replacementId);

  await login(page, user.email, user.password);
  await page.goto("/calculate?meal=dinner");

  // A food-shaped phrase for an invented word Gemini can parse (one item,
  // amount=1, unit="serving") but can never match in the database — as of
  // Phase 3 this resolves to a clearly-labeled AI estimate rather than a
  // dead end, offering "Use a real database food instead" as the manual
  // escape hatch this test exercises.
  await page.getByPlaceholder("What did you eat?").fill("a bowl of zorbnaxfruit stew");
  await page.getByRole("button", { name: "Calculate" }).click();

  await expect(page.getByText("· Estimated")).toBeVisible({ timeout: 30_000 });
  // Requirement: an AI-estimated item must never have been logged just by
  // appearing in review.
  const logsBeforeResolving = await fetch(
    `${SUPABASE_URL}/rest/v1/food_logs?user_id=eq.${user.userId}&select=id`,
    { headers: adminHeaders },
  ).then((r) => r.json());
  expect(logsBeforeResolving).toHaveLength(0);

  await page.getByRole("button", { name: "Use a real database food instead" }).click();
  const searchBox = page.getByPlaceholder("Search foods…");
  await searchBox.fill(replacementName);
  await expect(page.getByTestId("food-search-results")).toBeVisible({ timeout: 10_000 });
  // The quick-add "+" button — same control the normal picker uses to log
  // immediately, but here `onSelect` is wired up so it hands the food back
  // to the calculator's review state instead.
  await page.getByRole("button", { name: `Add ${replacementName}` }).click();

  // Picking a food from the embedded picker must NOT log it immediately —
  // it should instead resolve the row, in place, back into the calculator's
  // own unconfirmed review state, using the item's originally parsed
  // amount/unit (amount=1, unit="serving" here) rather than anything the
  // picker's own amount field happened to default to.
  const amountInput = page.getByLabel(`Amount for ${replacementName}`);
  await expect(amountInput).toBeVisible({ timeout: 10_000 });
  await expect(amountInput).toHaveValue("1");
  await expect(page.getByText("Use a real database food instead")).toHaveCount(0);
  await expect(page.getByText("· Estimated")).toHaveCount(0);

  const logsAfterResolving = await fetch(
    `${SUPABASE_URL}/rest/v1/food_logs?user_id=eq.${user.userId}&select=id`,
    { headers: adminHeaders },
  ).then((r) => r.json());
  expect(logsAfterResolving).toHaveLength(0);

  // The resolved row now behaves like any other: editable, contributes to
  // the live total, and is the only thing the final batch confirmation
  // will persist.
  await expect(page.getByText(/Total:\s*200 kcal/)).toBeVisible({ timeout: 5_000 });
  const confirmButton = page.getByRole("button", { name: "Add 1 food to Dinner" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByText("Added 1 food to Dinner.")).toBeVisible({ timeout: 10_000 });

  // Duplicate-submit protection still holds: exactly one log, not two, and
  // the confirm button is gone so a second click isn't even possible.
  await expect(page.getByRole("button", { name: /Add .* food/ })).toHaveCount(0);
  const logsAfterConfirm = await fetch(
    `${SUPABASE_URL}/rest/v1/food_logs?user_id=eq.${user.userId}&select=id,food_item_id,quantity,calories`,
    { headers: adminHeaders },
  ).then((r) => r.json());
  expect(logsAfterConfirm).toHaveLength(1);
  expect(logsAfterConfirm[0].food_item_id).toBe(replacementId);
  expect(logsAfterConfirm[0].quantity).toBe(1);
  expect(logsAfterConfirm[0].calories).toBe(200);
});

test("removing an AI-estimated calculator item before confirming logs nothing", async ({ page }) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);

  await login(page, user.email, user.password);
  await page.goto("/calculate");

  await page.getByPlaceholder("What did you eat?").fill("a bowl of zorbnaxfruit stew");
  await page.getByRole("button", { name: "Calculate" }).click();

  const removeButton = page.getByRole("button", {
    name: /Remove ".*zorbnaxfruit.*" from review/,
  });
  await expect(removeButton).toBeVisible({ timeout: 30_000 });
  await removeButton.click();
  await expect(removeButton).toHaveCount(0);

  const logs = await fetch(
    `${SUPABASE_URL}/rest/v1/food_logs?user_id=eq.${user.userId}&select=id`,
    { headers: adminHeaders },
  ).then((r) => r.json());
  expect(logs).toHaveLength(0);
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
    // a match. As of Phase 3, an item Gemini *does* recognize as food-like
    // now falls back to an AI estimate rather than a dead end, so this
    // case only still exercises the true "no food-like phrase at all"
    // path (Gemini returns an empty item list) — kept as an `.or()` so a
    // stray "not confidently matched" response (if the wording once again
    // reads as vaguely food-shaped) would also still be accepted.
    await page.getByPlaceholder("What did you eat?").fill("zzqxflurbnoxious 42");
    await page.getByRole("button", { name: "Calculate" }).click();
    await expect(
      page
        .getByText("Couldn't recognize any food in that description.")
        .or(page.getByText("Couldn't confidently match this to a food in the database.")),
    ).toBeVisible({ timeout: 30_000 });
    // No confirm button should appear — nothing resolved to actually log.
    await expect(page.getByRole("button", { name: /Add .* food/ })).toHaveCount(0);
  } finally {
    await deleteUser(user.userId);
  }
});

test("AI calculator answers a nutrition question about a food with no database match using a clearly-labeled estimate, and only persists on explicit confirm", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);

  await login(page, user.email, user.password);
  await page.goto("/calculate?meal=snack");

  // A real-sounding but invented food name Gemini can estimate nutrition
  // for but will never find in the database -- the canonical Phase 3
  // scenario ("DATABASE NOT FOUND must not mean AI CALCULATION FAILED").
  await page
    .getByPlaceholder("What did you eat?")
    .fill("How many calories are in 200g of a fictional zorbnaxfruit?");
  await page.getByRole("button", { name: "Calculate" }).click();

  await expect(page.getByText("· Estimated")).toBeVisible({ timeout: 30_000 });
  // Not persisted yet -- calculating alone must never log anything.
  const logsBeforeConfirm = await fetch(
    `${SUPABASE_URL}/rest/v1/food_logs?user_id=eq.${user.userId}&select=id`,
    { headers: adminHeaders },
  ).then((r) => r.json());
  expect(logsBeforeConfirm).toHaveLength(0);

  const confirmButton = page.getByRole("button", { name: "Add 1 food to Snacks" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByText("Added 1 food to Snacks.")).toBeVisible({ timeout: 10_000 });

  const logsAfterConfirm = await fetch(
    `${SUPABASE_URL}/rest/v1/food_logs?user_id=eq.${user.userId}&select=id,source,food_item_id`,
    { headers: adminHeaders },
  ).then((r) => r.json());
  expect(logsAfterConfirm).toHaveLength(1);
  expect(logsAfterConfirm[0].source).toBe("ai_estimate");
  // Confirming created a brand-new personal food_items row server-side
  // (get_or_create_personal_food) that this test never seeded itself, so it
  // isn't in pendingFoodIds yet -- without this, deleting the user only
  // nulls the row's created_by (ON DELETE SET NULL) instead of removing it,
  // leaking a near-zero-nutrition "zorbnaxfruit" row into every user's
  // smart-food-suggestions results.
  pendingFoodIds.push(logsAfterConfirm[0].food_item_id);

  // Today must show the same provenance, not present it as a verified food.
  await page.goto("/today");
  await expect(page.getByTestId("meal-snack").getByText("AI estimate")).toBeVisible({
    timeout: 10_000,
  });
});

test("Coach adds a food to the diary from a natural-language command and Today reflects it", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);

  await login(page, user.email, user.password);
  await page.goto("/coach");

  await page.getByPlaceholder("Ask the coach…").fill("Add 3 eggs to breakfast.");
  await page.getByRole("button", { name: "Send" }).click();

  const viewInToday = page.getByRole("link", { name: "View in Today" });
  await expect(viewInToday).toBeVisible({ timeout: 30_000 });
  await viewInToday.click();

  await expect(page).toHaveURL(/\/today/);
  const breakfast = page.getByTestId("meal-breakfast");
  await expect(breakfast).toContainText(/egg/i, { timeout: 10_000 });

  // The Coach's add-food action created a new personal food_items row
  // server-side (get_or_create_personal_food) that this test never seeded
  // itself -- track it for cleanup so it doesn't leak into every user's
  // smart-food-suggestions results (see the comment on pendingFoodIds above).
  const logs = await fetch(
    `${SUPABASE_URL}/rest/v1/food_logs?user_id=eq.${user.userId}&select=food_item_id`,
    { headers: adminHeaders },
  ).then((r) => r.json());
  pendingFoodIds.push(...logs.map((l: { food_item_id: string }) => l.food_item_id));
});

test("Coach refuses an out-of-scope programming request without answering it", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  pendingUserIds.push(user.userId);

  await login(page, user.email, user.password);
  await page.goto("/coach");

  await page.getByPlaceholder("Ask the coach…").fill("Write Python code to add two numbers.");
  await page.getByRole("button", { name: "Send" }).click();

  const reply = page.locator("div.bg-surface-container-lowest").last();
  await expect(reply).toBeVisible({ timeout: 30_000 });
  const replyText = (await reply.textContent()) ?? "";
  expect(replyText).not.toContain("def ");
  expect(replyText.toLowerCase()).toMatch(/fitness|nutrition/);
});

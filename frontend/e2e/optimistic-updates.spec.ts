import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 3 (performance/responsiveness audit fixes): optimistic food/water
// updates, targeted refreshes instead of a coarse reloadDay(), and request
// hygiene (no unrelated fetches triggered by a single-domain mutation).
// These prove TRUE optimism -- state changing before the network request
// resolves -- by holding a real request open via route interception and
// asserting the UI already updated, then either releasing it (success) or
// failing it (rollback).

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

async function seedFoodItem(
  name: string,
  serving = "1 serving",
  nutrition = { calories: 200, protein_g: 10, carbs_g: 20, fat_g: 8 },
) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/food_items`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ name, serving_description: serving, ...nutrition }),
  });
  if (!res.ok) throw new Error(`seed food failed: ${res.status} ${await res.text()}`);
  const id = (await res.json())[0].id as string;
  return id;
}

async function deleteFoodItem(id: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/food_items?id=eq.${id}`, {
    method: "DELETE",
    headers: adminHeaders,
  }).catch(() => {});
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const initialWaterLoad = page.waitForResponse(
    (res) =>
      res.url().includes("/api/water-logs") &&
      res.request().method() === "GET" &&
      res.status() === 200,
  );
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
  // The initial load fetches food/water/glass-sizes/suggestions in
  // parallel -- waiting for the real GET here (rather than trusting the
  // "0 ml" placeholder text, which renders identically whether water has
  // loaded to zero or hasn't loaded at all) avoids a race where a test's
  // very next click lands before `water` state exists yet.
  await initialWaterLoad;
}

async function quickAdd(page: import("@playwright/test").Page, foodName: string, meal: string) {
  await page.getByLabel("Meal to add to").selectOption(meal);
  await page.getByPlaceholder("Search foods…").fill(foodName);
  const results = page.getByTestId("food-search-results");
  await expect(results).toContainText(foodName, { timeout: 10_000 });
  await results.getByRole("button", { name: `Add ${foodName}` }).click();
}

// ---------------------------------------------------------------------------
// Food: optimistic add/edit/delete + rollback
// ---------------------------------------------------------------------------

test("food add appears in the diary immediately, before the network request resolves", async ({
  page,
}) => {
  const user = await createOnboardedUser("opt-add");
  const foodName = `__e2e_opt_add_${Date.now()}`;
  const foodId = await seedFoodItem(foodName);
  try {
    await login(page, user.email, user.password);

    let releaseRequest: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/api/food-logs", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });

    await quickAdd(page, foodName, "lunch");

    // Visible almost immediately -- well before the held request is ever
    // released -- proving this came from the optimistic path, not the
    // server response.
    const entry = page.getByTestId("meal-lunch").locator("li", { hasText: foodName });
    await expect(entry).toBeVisible({ timeout: 1_000 });
    await expect(entry).toContainText("200 kcal");

    releaseRequest();
    // Still there (and not duplicated) once the real response reconciles it.
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(entry).toHaveCount(1);
  } finally {
    await deleteUser(user.userId);
    await deleteFoodItem(foodId);
  }
});

test("a failed food add rolls back the optimistic entry and shows a friendly error", async ({
  page,
}) => {
  const user = await createOnboardedUser("opt-add-fail");
  const foodName = `__e2e_opt_addfail_${Date.now()}`;
  const foodId = await seedFoodItem(foodName);
  try {
    await login(page, user.email, user.password);

    await page.route("**/api/food-logs", async (route) => {
      if (route.request().method() === "POST") {
        // A small delay so the optimistic entry has a moment to actually
        // render before the failure response arrives and rolls it back --
        // otherwise both happen within the same tick and there'd be
        // nothing to observe in between.
        await new Promise((r) => setTimeout(r, 400));
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "boom" }),
        });
        return;
      }
      await route.continue();
    });

    await quickAdd(page, foodName, "lunch");

    const entry = page.getByTestId("meal-lunch").locator("li", { hasText: foodName });
    await expect(entry).toBeVisible({ timeout: 2_000 });
    await expect(entry).toHaveCount(0, { timeout: 10_000 });
    // Shown both as Today's action error and FoodPicker's own inline error
    // -- either is a correct, friendly (non-raw) message.
    await expect(
      page.getByText("We couldn't save that food. Please try again.").first(),
    ).toBeVisible();
  } finally {
    await deleteUser(user.userId);
    await deleteFoodItem(foodId);
  }
});

test("editing a food entry updates it immediately and rolls back on failure", async ({ page }) => {
  const user = await createOnboardedUser("opt-edit");
  const foodName = `__e2e_opt_edit_${Date.now()}`;
  const foodId = await seedFoodItem(foodName);
  try {
    await login(page, user.email, user.password);
    await quickAdd(page, foodName, "lunch");
    const lunch = page.getByTestId("meal-lunch");
    const entry = lunch.locator("li", { hasText: foodName });
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(entry).toContainText("200 kcal");

    await page.route("**/api/food-logs/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise((r) => setTimeout(r, 400));
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "boom" }),
        });
        return;
      }
      await route.continue();
    });

    await entry.getByRole("button", { name: `Edit ${foodName}` }).click();
    await lunch.getByLabel("Quantity").fill("2");
    await lunch.getByRole("button", { name: `Save ${foodName}` }).click();

    // Doubled immediately, before the (failing) response comes back.
    await expect(entry).toContainText("400 kcal", { timeout: 1_000 });
    // Rolled back to the real, pre-edit value once the failure lands.
    await expect(entry).toContainText("200 kcal", { timeout: 10_000 });
    await expect(
      page.getByText("We couldn't update that entry. Please try again."),
    ).toBeVisible();
  } finally {
    await deleteUser(user.userId);
    await deleteFoodItem(foodId);
  }
});

test("deleting a food entry removes it immediately and restores it on failure", async ({ page }) => {
  const user = await createOnboardedUser("opt-delete");
  const foodName = `__e2e_opt_delete_${Date.now()}`;
  const foodId = await seedFoodItem(foodName);
  try {
    await login(page, user.email, user.password);
    await quickAdd(page, foodName, "lunch");
    const entry = page.getByTestId("meal-lunch").locator("li", { hasText: foodName });
    await expect(entry).toBeVisible({ timeout: 10_000 });

    await page.route("**/api/food-logs/*", async (route) => {
      if (route.request().method() === "DELETE") {
        await new Promise((r) => setTimeout(r, 400));
        await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return;
      }
      await route.continue();
    });

    page.once("dialog", (dialog) => dialog.accept());
    await entry.getByRole("button", { name: `Remove ${foodName}` }).click();

    // Gone immediately -- before the (failing) response comes back.
    await expect(entry).toHaveCount(0, { timeout: 1_000 });
    // Restored once the failure lands.
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("We couldn't remove that entry. Please try again."),
    ).toBeVisible();
  } finally {
    await deleteUser(user.userId);
    await deleteFoodItem(foodId);
  }
});

// ---------------------------------------------------------------------------
// Water: optimistic add/remove + rollback
// ---------------------------------------------------------------------------

test("water add updates the visible total immediately, before the network request resolves", async ({
  page,
}) => {
  const user = await createOnboardedUser("opt-water-add");
  try {
    await login(page, user.email, user.password);
    const waterTotal = page.getByTestId("water-total");
    await expect(waterTotal).toContainText("0");

    let releaseRequest: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/api/water-logs", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });

    await page.getByRole("button", { name: /Add one \d+ml glass/ }).click();
    // "250 ml" -- checked as an exact value, not "not 0 ml" (which would
    // spuriously match "250 ml" itself, since it contains that substring).
    await expect(waterTotal).toHaveText("250 ml", { timeout: 1_000 });

    releaseRequest();
    await expect(waterTotal).toHaveText("250 ml", { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

test("a failed water add rolls back the optimistic total and shows a friendly error", async ({
  page,
}) => {
  const user = await createOnboardedUser("opt-water-fail");
  try {
    await login(page, user.email, user.password);
    const waterTotal = page.getByTestId("water-total");
    await expect(waterTotal).toHaveText("0 ml");

    await page.route("**/api/water-logs", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 400));
        await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: /Add one \d+ml glass/ }).click();
    await expect(waterTotal).toHaveText("250 ml", { timeout: 1_000 });
    await expect(waterTotal).toHaveText("0 ml", { timeout: 10_000 });
    await expect(
      page.getByText("We couldn't update your water log. Please try again."),
    ).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("removing water updates the total immediately using the server's own corrected total", async ({
  page,
}) => {
  const user = await createOnboardedUser("opt-water-remove");
  try {
    await login(page, user.email, user.password);
    await page.getByRole("button", { name: /Add one \d+ml glass/ }).click();
    const waterTotal = page.getByTestId("water-total");
    await expect(waterTotal).toHaveText("250 ml", { timeout: 10_000 });

    let releaseRequest: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/api/water-logs/remove", async (route) => {
      await gate;
      await route.continue();
    });

    await page.getByRole("button", { name: /Remove one \d+ml glass/ }).click();
    await expect(waterTotal).toContainText("0 ml", { timeout: 1_000 });
    releaseRequest();
    await expect(waterTotal).toContainText("0 ml", { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

// ---------------------------------------------------------------------------
// Glass sizes: targeted refresh, no unrelated food/suggestion fetch
// ---------------------------------------------------------------------------

test("adding a glass size never refetches food logs or suggestions", async ({ page }) => {
  const user = await createOnboardedUser("opt-glass");
  try {
    await login(page, user.email, user.password);
    await expect(page.getByTestId("water-total")).toBeVisible();
    // Let the initial page load fully settle before counting.
    await page.waitForTimeout(500);

    let foodLogGets = 0;
    let suggestionGets = 0;
    page.on("request", (req) => {
      if (req.method() !== "GET") return;
      if (req.url().includes("/api/food-logs")) foodLogGets += 1;
      if (req.url().includes("/api/suggestions")) suggestionGets += 1;
    });

    await page.getByRole("button", { name: "+ Custom size" }).click();
    await page.getByPlaceholder("Big bottle").fill("Big bottle");
    await page.getByLabel("Volume (ml)").fill("750");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "+750ml" })).toBeVisible({ timeout: 10_000 });

    expect(foodLogGets).toBe(0);
    expect(suggestionGets).toBe(0);
  } finally {
    await deleteUser(user.userId);
  }
});

// ---------------------------------------------------------------------------
// Auth/session: authFetch now reads the token SessionProvider already
// resolved, instead of independently awaiting getSession() every call.
// ---------------------------------------------------------------------------

test("authenticated requests still succeed with the shared session token", async ({ page }) => {
  const user = await createOnboardedUser("auth-ok");
  try {
    await login(page, user.email, user.password);
    // Today's data only renders once its authenticated fetches succeed.
    await expect(page.getByTestId("water-total")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("consumed-calories")).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("switching users in the same tab never reuses the previous user's token or data", async ({
  page,
}) => {
  const userA = await createOnboardedUser("switch-a");
  const userB = await createOnboardedUser("switch-b");
  const foodName = `__e2e_switch_food_${Date.now()}`;
  const foodId = await seedFoodItem(foodName);
  try {
    await login(page, userA.email, userA.password);
    await quickAdd(page, foodName, "lunch");
    await expect(
      page.getByTestId("meal-lunch").locator("li", { hasText: foodName }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("app-sidebar").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    await login(page, userB.email, userB.password);
    // User B's diary must be empty -- never user A's food. If the old
    // per-call getSession() race (or a naive global-token cache) served a
    // stale/previous-user token, this could otherwise leak A's data.
    await expect(
      page.getByTestId("meal-lunch").locator("li", { hasText: foodName }),
    ).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await deleteUser(userA.userId);
    await deleteUser(userB.userId);
    await deleteFoodItem(foodId);
  }
});

// ---------------------------------------------------------------------------
// Request hygiene: the initial Today load still fetches each domain
// exactly once (no duplicate requests introduced by the refactor).
// ---------------------------------------------------------------------------

test("Today's initial load fetches each domain exactly once", async ({ page }) => {
  const user = await createOnboardedUser("hygiene");
  try {
    const counts: Record<string, number> = {};
    page.on("request", (req) => {
      if (req.method() !== "GET") return;
      const url = req.url();
      for (const key of ["/api/food-logs", "/api/water-logs", "/api/glass-sizes", "/api/suggestions"]) {
        if (url.includes(key)) counts[key] = (counts[key] ?? 0) + 1;
      }
    });

    await login(page, user.email, user.password);
    await expect(page.getByTestId("water-total")).toBeVisible();
    await page.waitForTimeout(1_000);

    for (const key of ["/api/food-logs", "/api/water-logs", "/api/glass-sizes", "/api/suggestions"]) {
      expect(counts[key] ?? 0).toBe(1);
    }
  } finally {
    await deleteUser(user.userId);
  }
});

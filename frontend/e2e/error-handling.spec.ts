import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Covers the P0/P1-4 fixes from the post-deployment audit:
// - the goal/rate race in the calorie-target calculator (never runs, and
//   never shows a misleading "0 kcal", while a cut/bulk rate is unset)
// - global frontend error sanitization (no raw HTTP status/JSON/Supabase
//   text ever reaches the rendered page, even when a request fails)

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
      username: `e2eerr${Date.now() % 100000}`,
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
  await fetch(`${SUPABASE_URL}/rest/v1/weight_logs`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ user_id: userId, weight_kg: 80 }),
  });

  return { email, password, userId };
}

async function deleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

async function login(page: import("@playwright/test").Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
}

test("switching to Cut without picking a rate never shows a misleading 0 kcal target", async ({
  page,
}) => {
  const user = await createOnboardedUser("rate-race");
  try {
    await login(page, user);

    const sidebar = page.getByTestId("app-sidebar");
    await sidebar.getByRole("button", { name: "Weight goal" }).click();
    await sidebar.getByRole("button", { name: "Edit weight & goal" }).click();

    const editor = page.getByRole("dialog", { name: "Profile & settings" });
    await expect(editor).toBeVisible();

    // Switch to Cut but deliberately do NOT pick a rate.
    await editor.getByRole("button", { name: "Cut" }).click();

    // The calculator must refuse to run and must never render a "0 kcal"
    // target -- the calorie-target element shouldn't even be in the DOM
    // while the required rate is missing.
    await expect(editor.getByTestId("selected-calories")).toHaveCount(0);
    await expect(editor.getByText("Choose a weekly pace above to calculate your targets.")).toBeVisible();

    // Save must stay disabled -- there's no valid target to submit.
    await expect(editor.getByRole("button", { name: "Save & recalculate targets" })).toBeDisabled();

    // Picking a rate now makes the calculator run normally.
    await editor.getByRole("button", { name: "Lose 0.5 kg/week", exact: false }).click();
    await expect(editor.getByTestId("selected-calories")).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

test("a failed goals request shows a friendly message, never raw HTTP/JSON details", async ({
  page,
}) => {
  const user = await createOnboardedUser("goals-error");
  try {
    // Force every macro-targets call to fail with a raw backend-shaped
    // error body -- proves the UI never leaks it, regardless of cause.
    await page.route("**/api/macro-targets", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Internal Server Error: boom" }),
      }),
    );

    await login(page, user);
    const sidebar = page.getByTestId("app-sidebar");
    await sidebar.getByRole("button", { name: "Weight goal" }).click();
    await sidebar.getByRole("button", { name: "Edit weight & goal" }).click();
    const editor = page.getByRole("dialog", { name: "Profile & settings" });
    await expect(editor).toBeVisible();

    await expect(editor.getByText("We couldn't calculate your targets. Please try again.")).toBeVisible({
      timeout: 10_000,
    });

    // innerText (not textContent) -- only rendered, visible text, excluding
    // Next.js's embedded RSC flight data inside <script> tags, which is not
    // something a user ever sees.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Internal Server Error");
    expect(bodyText).not.toContain("macro-targets request failed");
    expect(bodyText).not.toMatch(/"detail"/);
  } finally {
    await deleteUser(user.userId);
  }
});

test("a failed diary load shows a friendly message, never a raw HTTP status or API path", async ({
  page,
}) => {
  const user = await createOnboardedUser("diary-error");
  try {
    await page.route("**/api/food-logs*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Not Found" }),
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText("We couldn't load today's diary. Please try again.")).toBeVisible({
      timeout: 15_000,
    });

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("404");
    expect(bodyText).not.toContain("Not Found");
    expect(bodyText).not.toContain("/api/food-logs");
    expect(bodyText).not.toContain("failed (");
  } finally {
    await deleteUser(user.userId);
  }
});

test("a wrong password shows a friendly message, never Supabase's raw error text", async ({ page }) => {
  const user = await createOnboardedUser("login-error");
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(
      page.getByText("That email or password doesn't look right. Please try again."),
    ).toBeVisible({ timeout: 10_000 });

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).not.toContain("invalid login credentials");
  } finally {
    await deleteUser(user.userId);
  }
});

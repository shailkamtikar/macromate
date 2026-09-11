import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 2: the persistent application-level sidebar/shell. Covers the
// desktop rail (expand/collapse), the mobile drawer, each settings
// section, primary navigation reached from the sidebar, and logout —
// against a real authenticated user and the real backend.

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

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
}

test("authenticated user sees the persistent desktop sidebar, and it survives navigation", async ({
  page,
}) => {
  const user = await createOnboardedUser("shellnav");
  try {
    await login(page, user.email, user.password);

    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText("MacroMate")).toBeVisible();

    // Reaches every primary area without a second, competing nav
    // implementation — same sidebar, no page rebuilds it.
    await sidebar.getByRole("link", { name: "Progress" }).click();
    await expect(page).toHaveURL(/\/progress/);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();

    await sidebar.getByRole("link", { name: "Coach" }).click();
    await expect(page).toHaveURL(/\/coach/);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();

    await sidebar.getByRole("link", { name: "Friends" }).click();
    await expect(page).toHaveURL(/\/friends/);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();

    await sidebar.getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("heading", { name: "Today's Diary" })).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("desktop sidebar collapses and expands, keeping navigation usable, and remembers the preference", async ({
  page,
}) => {
  const user = await createOnboardedUser("shellcollapse");
  try {
    await login(page, user.email, user.password);

    const sidebar = page.getByTestId("app-sidebar");
    const toggle = page.getByTestId("app-sidebar-toggle");
    await expect(sidebar.getByText("MacroMate")).toBeVisible();

    await toggle.click();
    // Collapsed: labels hide, but the same links remain reachable by icon
    // (accessible name still resolves via the title/aria attributes).
    await expect(sidebar.getByText("MacroMate")).not.toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Progress" })).toBeVisible();
    await sidebar.getByRole("link", { name: "Progress" }).click();
    await expect(page).toHaveURL(/\/progress/);

    // The collapsed preference persists across a reload.
    await page.reload();
    await expect(page.getByTestId("app-sidebar").getByText("MacroMate")).not.toBeVisible();

    await page.getByTestId("app-sidebar-toggle").click();
    await expect(page.getByTestId("app-sidebar").getByText("MacroMate")).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("mobile drawer opens and closes cleanly without a permanent desktop rail", async ({
  page,
}) => {
  const user = await createOnboardedUser("shellmobile");
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, user.email, user.password);

    // No permanent rail eating screen space on mobile.
    await expect(page.getByTestId("app-sidebar")).toBeHidden();
    const menuButton = page.getByRole("button", { name: "Menu" });
    await expect(menuButton).toBeVisible();

    await menuButton.click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Progress" })).toBeVisible();

    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();

    // Reopen and close via its own close button.
    await menuButton.click();
    await expect(drawer).toBeVisible();
    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(drawer).not.toBeVisible();

    // The bottom nav (mobile primary navigation) is still there and usable
    // — the drawer doesn't cover or replace it.
    await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("every sidebar settings section expands and exposes real, working controls", async ({
  page,
}) => {
  const user = await createOnboardedUser("shellsections");
  try {
    await login(page, user.email, user.password);
    const sidebar = page.getByTestId("app-sidebar");

    // Profile.
    await sidebar.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: "Edit profile" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Profile", exact: true }).click(); // collapse again

    // Weight goal.
    await sidebar.getByRole("button", { name: "Weight goal" }).click();
    await expect(sidebar.getByText(/Goal:/)).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Edit weight & goal" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Weight goal" }).click();

    // Calories & macros.
    await sidebar.getByRole("button", { name: "Calories & macros", exact: true }).click();
    await expect(sidebar.getByText("2200 kcal", { exact: false })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Edit calories & macros" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Calories & macros", exact: true }).click();

    // Glass sizes — real inline add, not a link-out.
    await sidebar.getByRole("button", { name: "Glass sizes" }).click();
    await sidebar.getByLabel("Label").fill("Shell test cup");
    await sidebar.getByLabel("ml").fill("300");
    await sidebar.getByRole("button", { name: "Add" }).click();
    await expect(sidebar.getByText("Shell test cup (300ml)")).toBeVisible({ timeout: 10_000 });
    await sidebar.getByRole("button", { name: "Remove Shell test cup" }).click();
    await expect(sidebar.getByText("Shell test cup (300ml)")).toHaveCount(0, { timeout: 10_000 });
    await sidebar.getByRole("button", { name: "Glass sizes" }).click();

    // Appearance — real theme toggle, inline.
    await sidebar.getByRole("button", { name: "Appearance" }).click();
    await sidebar.getByRole("button", { name: "dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await sidebar.getByRole("button", { name: "light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await sidebar.getByRole("button", { name: "Appearance" }).click();

    // Notifications — real preferences, inline.
    await sidebar.getByRole("button", { name: "Notifications" }).click();
    await sidebar.getByRole("checkbox").first().click();
    await sidebar.getByRole("button", { name: "Save notification preferences" }).click();
    await expect(sidebar.getByText("Notification preferences saved.")).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await deleteUser(user.userId);
  }
});

test("logout via the sidebar clears the session and protected routes stay protected", async ({
  page,
}) => {
  const user = await createOnboardedUser("shelllogout");
  try {
    await login(page, user.email, user.password);
    await page.getByTestId("app-sidebar").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // Visiting a protected page directly after logout bounces back to
    // login rather than showing the previous session's data.
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

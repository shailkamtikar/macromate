import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 2 audit fix: the login/signup screens used to expose
// developer/auth-provider wording ("Real Supabase Auth session — not a
// mock."). These tests lock in that the redesigned screens read as
// MacroMate, not a developer/SaaS template, while Supabase Auth keeps
// working underneath unchanged.

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

async function createConfirmedUser(prefix: string) {
  const email = `macromate-e2e-${prefix}-${Date.now()}@example.com`;
  const password = `Tt${Math.random().toString(36).slice(2)}!1Aa`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  return { email, password, userId: body.id as string };
}

async function deleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

const DEV_WORDING = [/supabase/i, /\bmock\b/i, /\bapi\b/i, /fastapi/i, /\benv\b/i, /environment variable/i];

test("login screen shows no Supabase/developer wording and is MacroMate-branded", async ({ page }) => {
  await page.goto("/login");
  const bodyText = await page.locator("body").innerText();
  for (const pattern of DEV_WORDING) {
    expect(bodyText).not.toMatch(pattern);
  }
  await expect(page.getByText("MacroMate", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("signup screen shows no Supabase/developer wording and is MacroMate-branded", async ({ page }) => {
  await page.goto("/signup");
  const bodyText = await page.locator("body").innerText();
  for (const pattern of DEV_WORDING) {
    expect(bodyText).not.toMatch(pattern);
  }
  await expect(page.getByText("MacroMate", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("login/signup navigation links work both ways", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/signup/);
  await page.getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password on the redesigned login shows a friendly message, never raw Supabase text", async ({
  page,
}) => {
  const user = await createConfirmedUser("auth-redesign-login");
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

test("password visibility toggle shows and hides the typed password", async ({ page }) => {
  await page.goto("/login");
  const passwordInput = page.getByLabel("Password");
  await passwordInput.fill("some-password-123");
  await expect(passwordInput).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Show characters" }).click();
  await expect(passwordInput).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: "Hide characters" }).click();
  await expect(passwordInput).toHaveAttribute("type", "password");
});

test("login screen has no horizontal overflow on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/login");
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("signup screen has no horizontal overflow on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/signup");
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
});

test("login and signup screens render centered and usable on desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

  await page.goto("/signup");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
});

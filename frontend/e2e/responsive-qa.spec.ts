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
  const email = `macromate-e2e-responsive-${Date.now()}@example.com`;
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
      username: `e2eresp${Date.now() % 100000}`,
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

const PAGES = ["/today", "/calculate", "/coach", "/progress", "/friends", "/profile"];
// Phase 2 (app sidebar) explicitly calls out these sizes: three common
// mobile widths plus two common laptop/desktop widths.
const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

test("no horizontal overflow on any main page, mobile and desktop", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForTimeout(300); // let async data settle
        const hasOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        expect(hasOverflow, `${path} overflows horizontally at ${viewport.name}`).toBe(false);
      }
    }
  } finally {
    await deleteUser(user.userId);
  }
});

test("app sidebar (rail, collapsed rail, and mobile drawer) never causes horizontal overflow", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    async function hasOverflow() {
      return page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
    }

    // Desktop: expanded rail, then collapsed rail — neither should widen
    // the document past the viewport, and content keeps the extra width
    // once collapsed.
    for (const viewport of VIEWPORTS.filter((v) => v.name.startsWith("desktop"))) {
      await page.setViewportSize(viewport);
      await page.goto("/today");
      expect(await hasOverflow(), `expanded rail overflows at ${viewport.name}`).toBe(false);
      await page.getByTestId("app-sidebar-toggle").click();
      await expect(page.getByTestId("app-sidebar").getByText("MacroMate")).not.toBeVisible();
      expect(await hasOverflow(), `collapsed rail overflows at ${viewport.name}`).toBe(false);
      await page.getByTestId("app-sidebar-toggle").click(); // reset for the next viewport
    }

    // Mobile: the open drawer must not push the page wider than the
    // viewport either.
    for (const viewport of VIEWPORTS.filter((v) => v.name.startsWith("mobile"))) {
      await page.setViewportSize(viewport);
      await page.goto("/today");
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
      expect(await hasOverflow(), `open mobile drawer overflows at ${viewport.name}`).toBe(false);
    }
  } finally {
    await deleteUser(user.userId);
  }
});

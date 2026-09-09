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

test("no hydration warning when reloading with a dark-theme cookie already set", async ({
  page,
}) => {
  const email = `macromate-hydration-${Date.now()}@example.com`;
  const password = `Tt${Math.random().toString(36).slice(2)}!1Aa`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const userId = (await res.json()).id as string;
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: userId,
      username: `hydration${Date.now() % 100000}`,
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

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15000 });

    await page.goto("/profile");
    await page.getByRole("button", { name: "dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The real regression check: reload with the theme cookie already set,
    // so the server renders data-theme="dark" from the first byte, and
    // confirm React hydration doesn't complain about a mismatch on <html>.
    consoleErrors.length = 0;
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.waitForTimeout(500);

    const hydrationErrors = consoleErrors.filter(
      (e) => /hydrat/i.test(e) || /server.*client/i.test(e),
    );
    expect(
      hydrationErrors,
      `hydration-related console errors: ${JSON.stringify(hydrationErrors)}`,
    ).toEqual([]);

    // Also check a fresh navigation (new document load) to /today, still dark.
    consoleErrors.length = 0;
    await page.goto("/today");
    await page.waitForTimeout(500);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const hydrationErrors2 = consoleErrors.filter(
      (e) => /hydrat/i.test(e) || /server.*client/i.test(e),
    );
    expect(hydrationErrors2).toEqual([]);
  } finally {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
  }
});

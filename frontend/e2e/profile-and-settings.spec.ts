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
  const email = `macromate-e2e-profile-${Date.now()}@example.com`;
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
      username: `e2eprofile${Date.now() % 100000}`,
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

test("sidebar's Weight goal editor recalculates targets and persists; Appearance toggle persists", async ({
  page,
}) => {
  const user = await createOnboardedUser();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    // The persistent app sidebar (desktop rail at this default viewport)
    // is the central place for profile/settings — expand "Weight goal"
    // and open the real editor from there.
    const sidebar = page.getByTestId("app-sidebar");
    await sidebar.getByRole("button", { name: "Weight goal" }).click();
    await sidebar.getByRole("button", { name: "Edit weight & goal" }).click();

    const editor = page.getByRole("dialog", { name: "Profile & settings" });
    await expect(editor).toBeVisible();

    // Change goal to "Cut", pick a weight-loss rate, and weight, then save
    // — should recalculate a lower calorie target through the real backend.
    await editor.getByRole("button", { name: "Cut" }).click();
    await editor.getByRole("button", { name: "Lose 0.5 kg/week", exact: false }).click();
    await editor.getByLabel("Current weight (kg)").fill("80");

    const saveButton = editor.getByRole("button", { name: "Save & recalculate targets" });
    // Targets recalculate asynchronously (debounced call to the real
    // deterministic backend) — wait for that to finish before saving,
    // rather than racing it.
    await expect(saveButton).toBeEnabled({ timeout: 10_000 });
    await saveButton.click();
    await expect(editor.getByText("Saved — targets recalculated.")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "Close profile & settings" }).click();
    await expect(editor).not.toBeVisible();

    // Appearance is edited inline in the sidebar, no dialog needed.
    await sidebar.getByRole("button", { name: "Appearance" }).click();
    await sidebar.getByRole("button", { name: "dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The desktop rail is persistent — it's still there (and still knows
    // the theme) without needing to be reopened after reload.
    await expect(page.getByTestId("app-sidebar")).toBeVisible();

    // Logout, from the sidebar's own Account section, actually clears the
    // session and redirects.
    await page.getByTestId("app-sidebar").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

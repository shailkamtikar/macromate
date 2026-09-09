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
  const username = `${prefix}${Date.now() % 1000000}`;

  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: userId,
      username,
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

  return { email, password, userId, username };
}

async function deleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

test("friends page shows a real accepted friend on the leaderboard", async ({ page }) => {
  const a = await createOnboardedUser("e2efrienda");
  const b = await createOnboardedUser("e2efriendb");

  // Seed an already-accepted friendship directly (the request/accept flow
  // itself is covered by the backend's live test_friends_api.py).
  await fetch(`${SUPABASE_URL}/rest/v1/friendships`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      requester_id: a.userId,
      addressee_id: b.userId,
      status: "accepted",
    }),
  });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(a.email);
    await page.getByLabel("Password").fill(a.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });

    await page.goto("/friends");
    await expect(page.getByText(a.username)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(b.username)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("(you)")).toBeVisible();
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
  }
});

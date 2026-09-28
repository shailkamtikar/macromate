import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Coach's message input used to be a single-line <input> that couldn't
// hold a newline and clipped long text. These tests cover the replacement
// auto-growing <textarea>: wrapping, Shift+Enter for a newline, Enter to
// send, disabled-when-empty, and mobile layout.

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
  const email = `macromate-e2e-coachinput-${Date.now()}@example.com`;
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
      username: `e2ecoachin${Date.now() % 100000}`,
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

async function loginAndGoToCoach(page: import("@playwright/test").Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
  await page.goto("/coach");
}

test("long text wraps and grows the input instead of clipping it", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await loginAndGoToCoach(page, user);
    const input = page.getByLabel("Message Coach");
    const initialHeight = (await input.boundingBox())?.height ?? 0;

    const longText =
      "This is a deliberately long message meant to wrap across several lines so we can confirm the input grows to show it instead of clipping or scrolling it out of view horizontally.";
    await input.fill(longText);

    const grownHeight = (await input.boundingBox())?.height ?? 0;
    expect(grownHeight).toBeGreaterThan(initialHeight);
    await expect(input).toHaveValue(longText);
  } finally {
    await deleteUser(user.userId);
  }
});

test("Shift+Enter inserts a newline instead of sending", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await loginAndGoToCoach(page, user);
    const input = page.getByLabel("Message Coach");
    await input.click();
    await input.type("first line");
    await input.press("Shift+Enter");
    await input.type("second line");

    // The text is still sitting in the input, unsent -- if Shift+Enter had
    // instead submitted the form, handleSend would have cleared it to "".
    await expect(input).toHaveValue("first line\nsecond line");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  } finally {
    await deleteUser(user.userId);
  }
});

test("Enter sends the message and clears the input", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await loginAndGoToCoach(page, user);
    const input = page.getByLabel("Message Coach");
    // A deterministic fast-path question -- resolves without a live
    // Gemini call, keeping this UI test fast and non-flaky.
    await input.fill("How much protein do I have left?");
    await input.press("Enter");

    await expect(input).toHaveValue("");
    await expect(page.getByText("How much protein do I have left?")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/protein left/i)).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteUser(user.userId);
  }
});

test("an empty or whitespace-only message cannot be sent", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await loginAndGoToCoach(page, user);
    const input = page.getByLabel("Message Coach");
    const sendButton = page.getByRole("button", { name: "Send" });

    await expect(sendButton).toBeDisabled();

    await input.fill("   ");
    await expect(sendButton).toBeDisabled();
    await input.press("Enter");
    // Still on the empty-state prompt -- nothing was sent.
    await expect(
      page.getByText(/Ask something like/),
    ).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("Coach input does not overflow on a narrow mobile viewport", async ({ page }) => {
  const user = await createOnboardedUser();
  try {
    await page.setViewportSize({ width: 360, height: 780 });
    await loginAndGoToCoach(page, user);

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);

    const input = page.getByLabel("Message Coach");
    await input.fill(
      "A reasonably long mobile message to make sure the growing textarea still fits within the viewport width.",
    );
    const overflowAfterTyping = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowAfterTyping).toBe(false);
  } finally {
    await deleteUser(user.userId);
  }
});

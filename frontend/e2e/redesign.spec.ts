import { test, expect, Page } from "@playwright/test";

// Uses the seeded TEST user (backend/scripts/seed_test_user.py).
const EMAIL = process.env.E2E_SEED_EMAIL ?? "tester.a@example.com";
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? "Test@12345";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/today");
}

test("logged-out visitors get the landing page, dark by default, with a clickable live preview", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your nutrition");
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();

  const week = page.getByRole("group", { name: "Week" });
  await expect(week).toBeVisible();
  const first = week.getByRole("button").first();
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/signup/);
});

test("a signed-in user visiting / is sent to Today", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
});

test("theme: dark by default, switching to light persists across reloads", async ({ page }) => {
  await login(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("app-sidebar").getByRole("button", { name: "Appearance" }).click();
  await page.getByTestId("app-sidebar").getByRole("button", { name: "light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("Progress: logging a weight is validated and updates the history", async ({ page }) => {
  await login(page);
  await page.goto("/progress");
  const form = page.getByTestId("weight-quick-log");
  await expect(form).toBeVisible({ timeout: 15_000 });

  // Empty/zero is rejected inline, nothing is sent.
  await form.getByRole("button", { name: "Log weight" }).click();
  await expect(form.getByRole("alert")).toBeVisible();

  await form.getByLabel("Weight in kilograms").fill("78.3");
  await form.getByRole("button", { name: "Log weight" }).click();
  await expect(form.getByText("Logged 78.3 kg.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("78.3kg")).toBeVisible({ timeout: 10_000 });
});

test("mobile: Add meal button opens the food sheet and Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const fab = page.getByTestId("add-meal-fab");
  await expect(fab).toBeVisible({ timeout: 15_000 });
  await fab.click();
  await expect(page.getByPlaceholder("Search foods…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search foods…")).not.toBeInViewport();
});

test("deleting an entry offers Undo and Undo restores it without hitting the server", async ({ page }) => {
  await login(page);
  const diary = page.getByTestId("diary");
  await expect(diary).toBeVisible({ timeout: 15_000 });
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/api/food-logs/")) deletes.push(r.url());
  });
  const row = diary.getByRole("button", { name: /^Remove / }).first();
  await row.click();
  await expect(page.getByTestId("toast")).toContainText("Removed");
  await page.getByTestId("toast").getByRole("button", { name: "Undo" }).click();
  await expect(diary.getByRole("button", { name: /^Remove / }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(deletes).toHaveLength(0);
});

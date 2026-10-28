import { test, expect } from "@playwright/test";

// Uses the seeded TEST user (backend/scripts/seed_test_user.py) so the diary
// has real data. Proves the dashboard never waits on "What to eat next".
const EMAIL = process.env.E2E_SEED_EMAIL ?? "tester.a@example.com";
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? "Test@12345";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/today");
}

test("diary renders while suggestions are still loading", async ({ page }) => {
  await page.route("**/api/suggestions", async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await login(page);

  await expect(page.getByTestId("diary")).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId("consumed-calories")).toBeVisible();
  await expect(page.getByTestId("suggestions-skeleton")).toBeVisible();

  await expect(page.getByTestId("suggestions-card")).toBeVisible({ timeout: 15_000 });
});

test("a failing suggestions call shows a retry, not a page error", async ({ page }) => {
  let fail = true;
  await page.route("**/api/suggestions", async (route) => {
    if (fail) await route.fulfill({ status: 500, body: "boom" });
    else await route.continue();
  });
  await login(page);

  await expect(page.getByTestId("diary")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("suggestions-error")).toBeVisible({ timeout: 8000 });
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("suggestions-card")).toBeVisible({ timeout: 10_000 });
});

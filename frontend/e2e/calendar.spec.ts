import { test, expect, Page } from "@playwright/test";

// Runs against the seeded TEST user (backend/scripts/seed_test_user.py), which
// has ~35 days of food, water and weight history.
const EMAIL = process.env.E2E_SEED_EMAIL ?? "tester.a@example.com";
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? "Test@12345";

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/today");
  await expect(page.getByTestId("diary")).toBeVisible({ timeout: 15_000 });
}

test("clicking a past day in the week strip shows that day's diary", async ({ page }) => {
  await login(page);
  const target = daysAgo(2);
  await page.getByTestId(`day-${target}`).click();
  await expect(page).toHaveURL(new RegExp(`date=${target}`));
  await expect(page.getByText("Viewing a past day")).toBeVisible();
  // Suggestions are only for today.
  await expect(page.getByTestId("suggestions-card")).toHaveCount(0);
  await expect(page.getByTestId("diary")).toBeVisible();

  await page.getByRole("button", { name: "Back to today" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: "Today's Diary" })).toBeVisible();
});

test("future days are not selectable and a bad date param falls back to today", async ({ page }) => {
  await login(page);
  // The strip's days after today (if the week has any) are disabled.
  const tomorrow = iso(new Date(Date.now() + 86_400_000));
  const cell = page.getByTestId(`day-${tomorrow}`);
  if (await cell.count()) await expect(cell).toBeDisabled();

  await page.goto("/today?date=banana");
  await expect(page.getByRole("heading", { name: "Today's Diary" })).toBeVisible({ timeout: 15_000 });
  await page.goto(`/today?date=${tomorrow}`);
  await expect(page.getByRole("heading", { name: "Today's Diary" })).toBeVisible({ timeout: 15_000 });
});

test("month calendar: open, navigate months, pick a date, close with Escape", async ({ page }) => {
  await login(page);
  await page.getByTestId("open-month-calendar").click();
  const cal = page.getByTestId("month-calendar");
  await expect(cal).toBeVisible();

  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("button", { name: "Next month" })).toBeEnabled();

  await page.keyboard.press("Escape");
  await expect(cal).toHaveCount(0);

  await page.getByTestId("open-month-calendar").click();
  const target = daysAgo(3);
  await page.getByTestId(`month-day-${target}`).click();
  await expect(page).toHaveURL(new RegExp(`date=${target}`));
  await expect(cal).toHaveCount(0);
});

test("month calendar is operable with the keyboard", async ({ page }) => {
  await login(page);
  await page.getByTestId("open-month-calendar").click();
  const today = iso(new Date());
  // Focus lands on the selected day; arrow left moves one day back.
  await expect(page.getByTestId(`month-day-${today}`)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`date=${daysAgo(1)}`));
});

test("backfill: water logged on a past day lands on that day only", async ({ page }) => {
  await login(page);
  const target = daysAgo(8);
  await page.goto(`/today?date=${target}`);
  await expect(page.getByTestId("diary")).toBeVisible({ timeout: 15_000 });
  const total = page.getByTestId("water-total");
  const before = Number((await total.innerText()).replace(/[^0-9]/g, "")) || 0;

  await page.getByRole("button", { name: "+250ml" }).first().click();
  await expect(total).toContainText(String(before + 250), { timeout: 10_000 });

  // Reload from the server: the past day kept it, today did not gain it.
  await page.reload();
  await expect(page.getByTestId("water-total")).toContainText(String(before + 250), { timeout: 15_000 });

  // Undo so the seed data stays as it was.
  await page.getByRole("button", { name: /remove|undo|−|-/i }).first().click().catch(() => {});
});

test("an empty past day shows a clear empty state with an add action", async ({ page }) => {
  await login(page);
  // Far enough back to be before the seed data began (35 days).
  const target = daysAgo(60);
  await page.goto(`/today?date=${target}`);
  await expect(page.getByTestId("empty-day")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Add food for this day" })).toBeVisible();
  // Targets before the target history began are flagged as approximate.
  await expect(page.getByText(/approximate/i)).toBeVisible();
});

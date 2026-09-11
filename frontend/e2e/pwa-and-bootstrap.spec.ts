import { test, expect } from "@playwright/test";

// Static PWA surface: manifest, icons, service worker, offline fallback.
// These don't need an authenticated user -- they're app-shell-level assets.

test("manifest exists, is valid JSON, and has the required PWA metadata", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.name).toBe("MacroMate");
  expect(manifest.short_name).toBe("MacroMate");
  expect(manifest.display).toBe("standalone");
  expect(typeof manifest.theme_color).toBe("string");
  expect(typeof manifest.background_color).toBe("string");
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of manifest.icons) {
    expect(icon.src).toBeTruthy();
    expect(icon.sizes).toBeTruthy();
    expect(icon.type).toBe("image/png");
  }
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
});

test("manifest icons are wired and actually resolve", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.status(), `${icon.src} should be reachable`).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
});

test("offline fallback page exists", async ({ request }) => {
  const res = await request.get("/offline.html");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("MacroMate");
});

test("the page links the manifest and registers the service worker at the correct scope", async ({
  page,
}) => {
  await page.goto("/login");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");

  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state === "activated";
  });
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.scope;
  });
  expect(scope).toBe(new URL("/", page.url()).toString());
});

test("service worker registers exactly once even if the app remounts", async ({ page }) => {
  await page.goto("/login");
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state === "activated";
  });
  await page.reload();
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state === "activated";
  });
  const registrationCount = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length;
  });
  expect(registrationCount).toBe(1);
});

test("theme-color meta tags exist for both light and dark", async ({ page }) => {
  await page.goto("/login");
  const metas = await page.locator('meta[name="theme-color"]').all();
  expect(metas.length).toBeGreaterThanOrEqual(2);
});

// Bootstrap loader.

test("a throttled first load shows the branded MacroMate loader, not a bare spinner or blank page", async ({
  page,
  context,
}) => {
  const client = await context.newCDPSession(page);
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (50 * 1024) / 8,
    uploadThroughput: (20 * 1024) / 8,
    latency: 400,
  });
  await page.goto("/today", { waitUntil: "commit" });
  // exact:true -- the loader also carries a visually-hidden "Loading
  // MacroMate…" string for screen readers, which a loose match would also
  // catch.
  await expect(page.getByText("MacroMate", { exact: true })).toBeVisible();
  // No sidebar navigation should exist yet -- the shell renders only after
  // the loader gate clears.
  await expect(page.getByRole("link", { name: "Today" })).toHaveCount(0);
});

test("loader respects prefers-reduced-motion: no animation is defined for reduced-motion users", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const animationName = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "bootstrap-breathe";
    document.body.appendChild(probe);
    const name = getComputedStyle(probe).animationName;
    probe.remove();
    return name;
  });
  expect(animationName).toBe("none");
});

test("loader animation is defined when motion is not reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/login");
  const animationName = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "bootstrap-breathe";
    document.body.appendChild(probe);
    const name = getComputedStyle(probe).animationName;
    probe.remove();
    return name;
  });
  expect(animationName).toBe("bootstrap-breathe");
});

test("an unauthenticated deep link to a shell route redirects to login without ever showing the sidebar", async ({
  page,
}) => {
  await page.goto("/today");
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  await expect(page.getByRole("link", { name: "Today" })).toHaveCount(0);
});

test("no horizontal overflow on a narrow mobile viewport for the login screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/login");
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
});

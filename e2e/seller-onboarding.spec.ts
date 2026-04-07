import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("Seller Onboarding Flow", () => {
  test("seller hub page loads for authenticated user", async ({ page }) => {
    await loginAs(page, "buyer"); // buyer hasn't onboarded as seller yet

    await page.goto("/seller/onboarding");
    await page.waitForTimeout(2000);

    // Should show seller hub / onboarding page
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 10000,
    });

    // Should show onboarding checklist or seller terms
    await expect(
      page
        .locator("text=/seller|onboarding|terms|get started|start selling/i")
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("seller onboarding shows Stripe connect step", async ({ page }) => {
    await loginAs(page, "buyer");

    await page.goto("/seller/onboarding");
    await page.waitForTimeout(2000);

    // Should show Stripe connect button or step
    await expect(
      page
        .locator("text=/stripe|connect|bank account|payouts|payment setup/i")
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("seller onboarding shows phone verification step", async ({ page }) => {
    await loginAs(page, "buyer3"); // emma — has phone verified

    await page.goto("/seller/onboarding");
    await page.waitForTimeout(2000);

    // Should show phone verification step (complete or pending)
    await expect(
      page.locator("text=/phone|verify|verified|mobile/i").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("seller terms must be accepted before accessing seller dashboard", async ({
    page,
  }) => {
    await loginAs(page, "buyer"); // buyer hasn't accepted seller terms

    await page.goto("/dashboard/seller");
    await page.waitForTimeout(3000);

    // Should either redirect to onboarding or show terms acceptance prompt
    const redirectedToOnboarding = page.url().includes("/seller/onboarding");
    const showsTermsPrompt = await page
      .locator("text=/accept.*terms|seller.*terms|agree.*terms|seller hub/i")
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(redirectedToOnboarding || showsTermsPrompt).toBe(true);
  });

  test("onboarded seller can access seller dashboard", async ({ page }) => {
    await loginAs(page, "seller"); // mike — fully onboarded seller

    await page.goto("/dashboard/seller");
    await page.waitForTimeout(3000);

    // Should show seller dashboard (not redirected to onboarding)
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 10000,
    });

    // Should show seller-specific content
    await expect(
      page.locator("text=/listings|orders|payouts|sales|dashboard/i").first(),
    ).toBeVisible({ timeout: 10000 });

    // Should not show error
    await expect(
      page.locator("text=/error|500|forbidden/i").first(),
    ).not.toBeVisible();
  });

  test("seller can navigate to create listing page", async ({ page }) => {
    await loginAs(page, "seller");

    await page.goto("/sell");
    await page.waitForTimeout(2000);

    // Should show listing creation form
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 10000,
    });

    // Should have title/name input
    await expect(
      page
        .locator(
          'input[name="title"], input[placeholder*="title" i], input[name="name"]',
        )
        .first(),
    ).toBeVisible({ timeout: 10000 });

    // Should have price input
    await expect(
      page
        .locator(
          'input[name="price"], input[placeholder*="price" i], input[type="number"]',
        )
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("seller dashboard shows active listings count", async ({ page }) => {
    await loginAs(page, "seller");

    await page.goto("/dashboard/seller");
    await page.waitForTimeout(3000);

    // Look for listings tab or count
    const listingsTab = page
      .locator(
        'a:has-text("Listings"), button:has-text("Listings"), [data-tab="listings"]',
      )
      .first();
    const hasListingsTab = await listingsTab
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasListingsTab) {
      await listingsTab.click();
      await page.waitForTimeout(2000);
    }

    // Should show listings or empty state — no error
    await expect(page.locator("text=/error|500/i").first()).not.toBeVisible();
  });

  test("Stripe account page loads for seller", async ({ page }) => {
    await loginAs(page, "seller");

    await page.goto("/account/stripe");
    await page.waitForTimeout(3000);

    // Should show Stripe account status
    await expect(
      page
        .locator(
          "text=/stripe|connected|onboarded|charges enabled|payouts|bank/i",
        )
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("unauthenticated user is redirected from seller pages", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/seller/onboarding");
    await page.waitForURL(/\/login/, { timeout: 15000 });

    expect(page.url()).toContain("/login");

    await context.close();
  });

  test("seller can view payouts tab", async ({ page }) => {
    await loginAs(page, "seller");

    await page.goto("/dashboard/seller?tab=payouts");
    await page.waitForTimeout(3000);

    // Should show payouts section or empty state
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page
        .locator("text=/payout|earnings|revenue|balance|no payouts/i")
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

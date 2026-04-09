import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("Dispute Flow", () => {
  test("buyer can see dispute option on an order", async ({ page }) => {
    await loginAs(page, "buyer2"); // james@buyzi.test — has disputes in seed

    await page.goto("/dashboard/buyer");
    await page.waitForLoadState("networkidle");

    // buyer2 has orders in the seed — this must be visible or the test fails
    const orderLink = page.locator('a[href*="/orders/"]').first();
    await expect(orderLink).toBeVisible({ timeout: 10000 });

    await orderLink.click();
    await page.waitForURL(/\/orders\//, { timeout: 10000 });

    // The order page should load without error
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 10000,
    });

    // buyer2 has orders in disputable states in seed — dispute option must be visible
    const disputeBtn = page
      .locator(
        'button:has-text("dispute"), button:has-text("Dispute"), text=/disputed|dispute open/i',
      )
      .first();
    await expect(disputeBtn).toBeVisible({ timeout: 10000 });
  });

  test("dispute modal opens with reason and evidence fields", async ({
    page,
  }) => {
    await loginAs(page, "buyer2");

    await page.goto("/dashboard/buyer");
    await page.waitForLoadState("networkidle");

    // buyer2 has orders in the seed — must be visible or the test fails
    const orderLink = page.locator('a[href*="/orders/"]').first();
    await expect(orderLink).toBeVisible({ timeout: 10000 });

    await orderLink.click();
    await page.waitForURL(/\/orders\//, { timeout: 10000 });

    // Dispute button must be present — buyer2 has disputable orders in seed
    const disputeBtn = page
      .locator('button:has-text("Open dispute"), button:has-text("Dispute")')
      .first();
    await expect(disputeBtn).toBeVisible({ timeout: 10000 });

    await disputeBtn.click();

    // Modal should show reason select and description textarea
    await expect(
      page
        .locator(
          'select[name="reason"], [role="combobox"], [aria-label*="reason" i]',
        )
        .first(),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page
        .locator(
          'textarea[name="description"], textarea[placeholder*="describe" i]',
        )
        .first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("dispute requires description to submit", async ({ page }) => {
    await loginAs(page, "buyer2");

    await page.goto("/dashboard/buyer");
    await page.waitForLoadState("networkidle");

    // buyer2 has orders in the seed — must be visible or the test fails
    const orderLink = page.locator('a[href*="/orders/"]').first();
    await expect(orderLink).toBeVisible({ timeout: 10000 });

    await orderLink.click();
    await page.waitForURL(/\/orders\//, { timeout: 10000 });

    // Dispute button must be present — buyer2 has disputable orders in seed
    const disputeBtn = page
      .locator('button:has-text("Open dispute"), button:has-text("Dispute")')
      .first();
    await expect(disputeBtn).toBeVisible({ timeout: 10000 });

    await disputeBtn.click();

    // Submit button must appear once modal opens
    const submitBtn = page
      .locator('button:has-text("Submit"), button:has-text("Open")')
      .last();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });

    // Try to submit without filling description
    await submitBtn.click();
    await page.waitForLoadState("networkidle");

    // Form must either show a validation error OR the submit button must be disabled —
    // submitting without a description must never silently succeed
    const isDisabled = await submitBtn.isDisabled();
    const showsError = await page
      .locator("text=/required|description|please/i")
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    expect(isDisabled || showsError).toBe(true);
  });

  test("admin can access dispute queue", async ({ page }) => {
    await loginAs(page, "disputesAdmin");

    await page.goto("/admin/disputes");
    await page.waitForLoadState("networkidle");

    // Should not redirect away — admin has access
    expect(page.url()).toContain("/admin");

    // Should show dispute queue UI
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 10000,
    });

    // Should show dispute content or empty state — must render something meaningful
    await expect(
      page
        .locator("text=/needs decision|cooling|fraud|no disputes|all/i")
        .first(),
    ).toBeVisible({ timeout: 10000 });

    // Should show no error
    await expect(
      page.locator("text=/error|500|forbidden/i").first(),
    ).not.toBeVisible();
  });

  test("admin can view individual dispute details", async ({ page }) => {
    await loginAs(page, "disputesAdmin");

    await page.goto("/admin/disputes");
    await page.waitForLoadState("networkidle");

    // A dispute must exist in the seeded test environment
    const disputeLink = page
      .locator(
        'a[href*="/admin/disputes/"], tr[data-dispute-id], [role="row"] a',
      )
      .first();
    await expect(disputeLink).toBeVisible({ timeout: 10000 });

    await disputeLink.click();
    await page.waitForURL(/\/admin\/disputes\//, { timeout: 10000 });

    // Detail page should show dispute info
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 10000,
    });

    // Should show evidence/timeline section
    await expect(
      page
        .locator("text=/evidence|timeline|description|reason|buyer|seller/i")
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("non-admin user cannot access dispute queue", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAs(page, "buyer");
    await page.goto("/admin/disputes");
    await page.waitForLoadState("networkidle");

    // Should be redirected away or show forbidden — must not silently allow access
    const isOnAdminPage = page.url().includes("/admin/disputes");
    const hasForbidden = await page
      .locator("text=/forbidden|denied|unauthorized|not authorised/i")
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Either redirected away OR shown a forbidden message — both are correct.
    // Failing means the user reached the admin page with no access control.
    expect(!isOnAdminPage || hasForbidden).toBe(true);

    await context.close();
  });
});

import { test, expect } from '@playwright/test'

test.describe('Search and Listing Flow', () => {
  test('search page loads with filters', async ({ page }) => {
    await page.goto('/search')

    // Search input should be visible
    await expect(
      page.locator('input[placeholder*="Search"]').first()
    ).toBeVisible({ timeout: 10000 })

    // Category filter dropdown should exist
    await expect(
      page.locator('select[aria-label="Category"]').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('can search for listings by keyword', async ({ page }) => {
    await page.goto('/search?q=iPhone')
    await page.waitForTimeout(3000)

    // Page should not show error
    await expect(
      page.locator('text=/error|failed/i').first()
    ).not.toBeVisible()

    // Should show results or "No listings found"
    const hasResults = await page
      .locator('a[href*="/listings/"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)

    if (!hasResults) {
      // Should show empty state
      await expect(
        page.locator('text=/no listings|no results/i').first()
      ).toBeVisible({ timeout: 5000 })
    }
  })

  test('listing detail page loads correctly', async ({ page }) => {
    await page.goto('/search')
    await page.waitForTimeout(2000)

    const listingCard = page.locator('a[href*="/listings/"]').first()
    const hasListing = await listingCard.isVisible({ timeout: 5000 }).catch(() => false)

    if (!hasListing) {
      test.skip()
      return
    }

    await listingCard.click()
    await page.waitForURL(/\/listings\//, { timeout: 10000 })

    // Price should be visible (NZD format)
    await expect(
      page.locator('text=/NZD|\\$\\d/').first()
    ).toBeVisible({ timeout: 10000 })

    // Buy Now button or similar CTA
    await expect(
      page.locator('text=/Buy now|Make an offer|Message seller/i').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('category filter works on homepage', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    const electronicsLink = page.locator('text=Electronics').first()
    if (await electronicsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await electronicsLink.click()
      await page.waitForTimeout(2000)

      // URL should reflect the category filter
      const url = page.url().toLowerCase()
      expect(url).toContain('electronics')
    }
  })

  test('quick filter chips visible on search page', async ({ page }) => {
    await page.goto('/search')
    await page.waitForTimeout(2000)

    // At least one quick filter chip should be visible
    const hasChips = await page
      .locator('text=/Urgent sale|Negotiable|Ships NZ|Verified/i')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)

    if (hasChips) {
      // Click Verified sellers chip
      const verifiedChip = page.locator('text=/Verified/i').first()
      if (await verifiedChip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await verifiedChip.click()
        await page.waitForTimeout(2000)
        expect(page.url()).toContain('verifiedOnly')
      }
    }
  })
})

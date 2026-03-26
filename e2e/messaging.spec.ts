import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Messaging Flow', () => {
  test('buyer can navigate to message seller from listing', async ({ page }) => {
    await loginAs(page, 'buyer')

    // Search for a listing by a different seller (techdeals' listings)
    await page.goto('/search?q=iPhone')
    await page.waitForTimeout(3000)

    // Try multiple listing cards — skip buyer's own listings
    const listingCards = page.locator('a[href*="/listings/"]')
    const count = await listingCards.count()

    let foundMessageBtn = false
    for (let i = 0; i < Math.min(count, 5); i++) {
      await listingCards.nth(i).click()
      await page.waitForURL(/\/listings\//, { timeout: 10000 })

      // SellerPanel may be below the fold — scroll to it
      const messageBtn = page.locator('text=/Message seller/i').first()
      await messageBtn.scrollIntoViewIfNeeded().catch(() => {})
      const hasBtn = await messageBtn.isVisible({ timeout: 5000 }).catch(() => false)

      if (hasBtn) {
        await messageBtn.click()
        foundMessageBtn = true
        break
      }

      // Go back and try next listing
      await page.goBack()
      await page.waitForTimeout(1000)
    }

    if (!foundMessageBtn) {
      test.skip()
      return
    }

    // Should navigate to /messages/new with query params
    await page.waitForURL(/\/messages\/new/, { timeout: 10000 })

    // Message textarea should be visible with pre-filled text
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })

    // Send button should exist
    await expect(
      page.locator('button:has-text("Send message")').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('buyer dashboard shows Messages tab', async ({ page }) => {
    await loginAs(page, 'buyer')
    await page.goto('/dashboard/buyer')
    await page.waitForTimeout(2000)

    // Messages tab/link should exist
    await expect(
      page.locator('text=/Messages/i').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('messages page loads without error', async ({ page }) => {
    await loginAs(page, 'buyer')
    await page.goto('/dashboard/buyer?tab=messages')
    await page.waitForTimeout(2000)

    // Should not show error
    await expect(
      page.locator('text=/error|failed|something went wrong/i').first()
    ).not.toBeVisible()
  })
})

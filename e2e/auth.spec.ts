import { test, expect } from '@playwright/test'
import { loginAs, logout, TEST_USERS } from './helpers/auth'

test.describe('Authentication Flow', () => {
  test('homepage loads for unauthenticated user', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/KiwiMart/)

    // Should show Sign in link in navbar
    await expect(
      page.locator('a[href="/login"]').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('redirects to login when accessing protected route', async ({ page }) => {
    await page.goto('/dashboard/buyer')

    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('buyer can login successfully', async ({ page }) => {
    await loginAs(page, 'buyer')

    // Should land on dashboard or home after login
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 })

    // Account menu should be visible (proves authenticated state)
    await expect(
      page.locator('button[aria-label="Account menu"]').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows error for wrong password', async ({ page }) => {
    await page.goto('/login')
    await page.waitForSelector('input[type="email"]')

    await page.fill('input[type="email"]', TEST_USERS.buyer.email)
    await page.fill('input[type="password"]', 'WrongPassword123!')
    await page.waitForTimeout(500)
    await page.click('button[type="submit"]')

    // Should show error message — Auth.js returns generic "credentials" error
    await expect(
      page.locator('text=/incorrect|invalid|wrong|error|failed|credentials/i').first()
    ).toBeVisible({ timeout: 10000 })

    // Should stay on login page
    expect(page.url()).toContain('/login')
  })

  test('admin can access admin panel', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin')

    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 })
    expect(page.url()).toContain('/admin')
  })

  test('buyer cannot access admin panel', async ({ page }) => {
    await loginAs(page, 'buyer')
    await page.goto('/admin')

    // Should redirect away from admin
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/admin'),
      { timeout: 10000 }
    ).catch(() => {
      // If no redirect, check for forbidden/unauthorized content
    })

    // Either redirected away or shows forbidden
    const isOnAdmin = page.url().includes('/admin')
    if (isOnAdmin) {
      // Should show forbidden/unauthorized message
      await expect(
        page.locator('text=/forbidden|unauthorized|denied|not authorized/i').first()
      ).toBeVisible({ timeout: 5000 })
    }
  })
})

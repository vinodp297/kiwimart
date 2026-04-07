import { Page } from "@playwright/test";

export const TEST_USERS = {
  buyer: {
    email: "sarah@buyzi.test",
    password: "BuyerPass123!",
  },
  buyer2: {
    email: "james@buyzi.test",
    password: "BuyerPass123!",
  },
  buyer3: {
    email: "emma@buyzi.test",
    password: "BuyerPass123!",
  },
  seller: {
    email: "mike@buyzi.test",
    password: "SellerPass123!",
  },
  seller2: {
    email: "rachel@buyzi.test",
    password: "SellerPass123!",
  },
  admin: {
    email: "admin@buyzi.test",
    password: "AdminPass123!",
  },
  disputesAdmin: {
    email: "disputes@buyzi.test",
    password: "AdminPass123!",
  },
};

export async function loginAs(page: Page, role: keyof typeof TEST_USERS) {
  const user = TEST_USERS[role];

  await page.goto("/login");
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });

  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);

  // Turnstile is skipped when NODE_ENV !== 'production' (see auth.ts line 63)
  // Allow a brief moment for any client-side validation
  await page.waitForTimeout(500);

  await page.click('button[type="submit"]');

  // Wait for redirect away from login page
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 15000,
  });
}

export async function logout(page: Page) {
  // Open account menu and click Sign out
  const accountMenu = page.locator('button[aria-label="Account menu"]').first();

  if (await accountMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
    await accountMenu.click();
    await page.locator('button:has-text("Sign out")').first().click();
    await page.waitForURL("/", { timeout: 10000 });
  } else {
    // Fallback: hit signout API directly
    await page.goto("/api/auth/signout");
  }
}

import { defineConfig, devices } from "@playwright/test";

// ─── Playwright config — hermetic E2E ──────────────────────────────────────
// Local: `TEST_DATABASE_URL=… npx playwright test` resets the test DB via
// globalSetup, then boots `npm run start` against the production build so
// we exercise the same code path Vercel ships.
// CI:   the e2e job provisions a scratch Postgres, sets DATABASE_URL to a
// buyzi_test database, and the same globalSetup runs.
//
// The webServer block intentionally uses `reuseExistingServer` ONLY outside
// CI so `npx playwright test` against a dev server that's already running
// still works locally — but CI always starts a fresh build-and-start.

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/setup/**"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  // Runs once before any tests (and before the webServer boots).
  globalSetup: "./e2e/setup/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Mobile viewport tests are in mobile.spec.ts with their own viewport override.
    // To run a full iPhone emulation project, install webkit: npx playwright install webkit
  ],
  webServer: {
    // Build once, then `next start`. Matches production behaviour and
    // stops dev-only features (e.g. React Fast Refresh) from polluting E2E.
    command: process.env.CI
      ? `npm run build && npm run start -- --port ${port}`
      : `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

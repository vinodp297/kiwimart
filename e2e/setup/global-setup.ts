// e2e/setup/global-setup.ts
// ─── Hermetic E2E setup — runs ONCE before Playwright starts its webServer ──
// Resets the test database to a known state and seeds deterministic fixtures.
//
// Safety guard: refuses to run unless DATABASE_URL is clearly a test database
// (contains "test") OR the process is running in CI. This prevents an
// accidental `playwright test` on a developer's laptop from nuking the dev
// database.
//
// To run locally:
//   TEST_DATABASE_URL=postgres://.../buyzi_test npx playwright test
//
// In CI, the e2e job provisions a scratch Postgres service and exports
// DATABASE_URL=postgres://…/buyzi_test, so the guard passes automatically.

import { execSync } from "node:child_process";

export default async function globalSetup(): Promise<void> {
  const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const isCI = Boolean(process.env.CI);

  if (!dbUrl) {
    throw new Error(
      "[e2e/global-setup] TEST_DATABASE_URL (or DATABASE_URL) is required",
    );
  }

  // Hard safety guard — NEVER touch a non-test database outside CI.
  const looksLikeTestDb =
    dbUrl.includes("test") ||
    dbUrl.includes("_e2e") ||
    dbUrl.includes("playwright");

  if (!isCI && !looksLikeTestDb) {
    throw new Error(
      "[e2e/global-setup] refusing to reset database — DATABASE_URL does " +
        'not contain "test" and we are not running in CI. ' +
        "Set TEST_DATABASE_URL to a test database before running Playwright.",
    );
  }

  // Forward the resolved URL to the rest of the Playwright run (webServer etc).
  process.env.DATABASE_URL = dbUrl;
  process.env.DATABASE_DIRECT_URL =
    process.env.TEST_DATABASE_DIRECT_URL ??
    process.env.DATABASE_DIRECT_URL ??
    dbUrl;

  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log("[e2e/global-setup] resetting test database…");

  // `db push --force-reset` drops & recreates the schema from schema.prisma.
  // Faster than `migrate reset` for E2E and doesn't depend on the migration
  // history being linear.
  execSync("npx prisma db push --force-reset --skip-generate", {
    stdio: "inherit",
    env: process.env,
  });

  // eslint-disable-next-line no-console
  console.log("[e2e/global-setup] seeding fixtures…");
  execSync("npx prisma db seed", {
    stdio: "inherit",
    env: process.env,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[e2e/global-setup] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

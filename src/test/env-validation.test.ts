// src/test/env-validation.test.ts
// ─── Env validation schema unit tests ────────────────────────────────────────
// Tests the envSchema directly so the validation logic can be exercised without
// touching the singleton env export (which skips validation in test env).

import { describe, it, expect } from "vitest";
import { envSchema, env } from "@/env";

// ── Shared valid fixture ──────────────────────────────────────────────────────

const VALID_ENV = {
  NODE_ENV: "production" as const,
  DATABASE_URL: "postgresql://user:pass@localhost:5432/buyzi",
  NEXTAUTH_SECRET: "super-secret-nextauth-key-at-least-32-chars",
  UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "upstash-token-abc123",
  STRIPE_SECRET_KEY: "sk_live_abc123def456",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123def456",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_abc123",
  RESEND_API_KEY: "re_abc123def456",
  NEXT_PUBLIC_R2_PUBLIC_URL: "https://r2.example.com",
  CLOUDFLARE_ACCOUNT_ID: "cloudflare-account-id",
  R2_ACCESS_KEY_ID: "r2-access-key-id",
  R2_SECRET_ACCESS_KEY: "r2-secret-access-key",
  R2_BUCKET_NAME: "buyzi-listings",
  NEXT_PUBLIC_APP_URL: "https://app.buyzi.co.nz",
  ENCRYPTION_KEY:
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  PUSHER_APP_ID: "1234567",
  PUSHER_KEY: "pusher-key-abc",
  PUSHER_SECRET: "pusher-secret-abc",
  PUSHER_CLUSTER: "ap4",
  NEXT_PUBLIC_PUSHER_KEY: "pusher-pub-key-abc",
  NEXT_PUBLIC_PUSHER_CLUSTER: "ap4",
  GOOGLE_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  // 64-char hex — satisfies min(32) + /^[0-9a-fA-F]+$/ requirements
  MOBILE_JWT_SECRET:
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("env-validation", () => {
  it("passes with a complete, valid environment", () => {
    const result = envSchema.safeParse(VALID_ENV);
    expect(result.success).toBe(true);
  });

  it("fails when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _removed, ...rest } = VALID_ENV;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const failedPaths = result.error.issues.map((i) => i.path[0]);
      expect(failedPaths).toContain("DATABASE_URL");
    }
  });

  it("fails when STRIPE_SECRET_KEY does not start with sk_", () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      STRIPE_SECRET_KEY: "pk_live_wrong_prefix",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const failedPaths = result.error.issues.map((i) => i.path[0]);
      expect(failedPaths).toContain("STRIPE_SECRET_KEY");
    }
  });

  it("fails when ENCRYPTION_KEY is not exactly 64 hex characters", () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      ENCRYPTION_KEY: "tooshort",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const failedPaths = result.error.issues.map((i) => i.path[0]);
      expect(failedPaths).toContain("ENCRYPTION_KEY");
    }
  });

  it("fails when NEXT_PUBLIC_APP_URL is missing", () => {
    const { NEXT_PUBLIC_APP_URL: _removed, ...rest } = VALID_ENV;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const failedPaths = result.error.issues.map((i) => i.path[0]);
      expect(failedPaths).toContain("NEXT_PUBLIC_APP_URL");
    }
  });

  it("lists ALL validation failures at once when multiple vars are missing", () => {
    const {
      DATABASE_URL: _db,
      NEXTAUTH_SECRET: _auth,
      STRIPE_SECRET_KEY: _stripe,
      ...rest
    } = VALID_ENV;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const failedPaths = result.error.issues.map((i) => i.path[0]);
      expect(failedPaths).toContain("DATABASE_URL");
      expect(failedPaths).toContain("NEXTAUTH_SECRET");
      expect(failedPaths).toContain("STRIPE_SECRET_KEY");
      // All three must appear in a single result — no fail-fast stopping at first error
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("skips validation in test environment (NODE_ENV=test) — env import does not throw", () => {
    // This test file already imports { env } from "@/env" at the top.
    // If validateEnv() had thrown (i.e. it did NOT skip in test env), the
    // module would have failed to load and no test in this file would run.
    // Reaching this assertion proves the test-env skip works correctly.
    expect(env).toBeDefined();
  });
});

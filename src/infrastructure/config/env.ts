// src/infrastructure/config/env.ts
// ─── Environment Variable Validation ─────────────────────────────────────────
// Validates ALL environment variables at startup using Zod.
// App will not start if any required var is missing or invalid.
//
// IMPORTANT: This file runs at import time.
// Do NOT import it in any file that runs during the Next.js build
// unless all env vars are present in the build environment.

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_DIRECT_URL: z.string().min(1),
  NEXTAUTH_SECRET: z
    .string()
    .min(
      32,
      "AUTH_SECRET must be at least 32 characters. Generate with: openssl rand -base64 32",
    ),
  NEXTAUTH_URL: z.string().url(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  PUSHER_APP_ID: z.string().min(1),
  PUSHER_KEY: z.string().min(1),
  PUSHER_SECRET: z.string().min(1),
  PUSHER_CLUSTER: z.string().min(1),
  NEXT_PUBLIC_PUSHER_KEY: z.string().min(1),
  NEXT_PUBLIC_PUSHER_CLUSTER: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  NEXT_PUBLIC_R2_PUBLIC_URL: z.string().url(),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  REDIS_URL: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  MOBILE_JWT_SECRET: z
    .string()
    .min(
      32,
      "MOBILE_JWT_SECRET must be at least 32 characters. Generate with: openssl rand -base64 32",
    )
    .optional(),
  CRON_SECRET: z.string().min(16),
  WORKER_SECRET: z.string().min(16),
  ADMIN_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
  // ── ENCRYPTION_KEY ──────────────────────────────────────────────────────────
  // AES-256-GCM field-level encryption key for phone numbers, TOTP secrets, etc.
  // Must be exactly 64 hex characters (32 bytes = 256-bit key).
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]+$/,
      "ENCRYPTION_KEY must be a hex string (characters 0-9 and a-f only)",
    )
    .refine(
      (val) => val.length === 64,
      "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256)",
    )
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const missing = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(", ")}`)
      .join("\n");
    throw new Error(
      `\n❌ Invalid environment variables:\n${missing}\n` +
        `\nCheck your .env.local file and Vercel environment settings.`,
    );
  }

  // ── Turnstile production enforcement ────────────────────────────────────
  // Cloudflare test keys (1x/2x prefix) auto-pass all challenges — zero bot
  // protection. Hard-fail in production so test keys can never ship.
  if (result.data.NODE_ENV === "production") {
    const turnstileSiteKey = result.data.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
    const turnstileSecretKey =
      result.data.CLOUDFLARE_TURNSTILE_SECRET_KEY ?? "";

    const siteKeyBad =
      !turnstileSiteKey ||
      turnstileSiteKey.startsWith("1x") ||
      turnstileSiteKey.startsWith("2x");
    const secretKeyBad =
      !turnstileSecretKey ||
      turnstileSecretKey.startsWith("1x") ||
      turnstileSecretKey.startsWith("2x");

    if (siteKeyBad || secretKeyBad) {
      throw new Error(
        "\n❌ PRODUCTION DEPLOYMENT BLOCKED: Turnstile keys are missing or using test keys!\n" +
          "   Bot protection would be completely DISABLED in production.\n" +
          "   Get real keys at: https://dash.cloudflare.com/turnstile\n" +
          "   Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and CLOUDFLARE_TURNSTILE_SECRET_KEY\n" +
          `   Site key bad: ${siteKeyBad} | Secret key bad: ${secretKeyBad}\n`,
      );
    }

    // ── MOBILE_JWT_SECRET production enforcement ─────────────────────────────
    // Must be set, at least 32 chars, and not a weak/default value.
    const mobileJwtSecret = result.data.MOBILE_JWT_SECRET ?? "";
    if (!mobileJwtSecret || mobileJwtSecret.length < 32) {
      throw new Error(
        "\n❌ PRODUCTION DEPLOYMENT BLOCKED: MOBILE_JWT_SECRET is missing or too short!\n" +
          "   Mobile JWT signing would be insecure or broken in production.\n" +
          "   Generate a secure secret with: openssl rand -base64 32\n" +
          "   Set MOBILE_JWT_SECRET in your Vercel environment settings.\n",
      );
    }
    const WEAK_MOBILE_JWT_VALUES = [
      "secret",
      "password",
      "changeme",
      "mobile_jwt_secret",
      "mobile-jwt-secret",
    ];
    const isAllSameChar = mobileJwtSecret
      .split("")
      .every((c) => c === mobileJwtSecret[0]);
    const isWeak = WEAK_MOBILE_JWT_VALUES.some((w) =>
      mobileJwtSecret.toLowerCase().includes(w),
    );
    if (isAllSameChar || isWeak) {
      throw new Error(
        "\n❌ PRODUCTION DEPLOYMENT BLOCKED: MOBILE_JWT_SECRET is weak or uses a known default value!\n" +
          "   The secret must be randomly generated and unpredictable.\n" +
          "   Generate a secure secret with: openssl rand -base64 32\n",
      );
    }

    // ── ENCRYPTION_KEY production enforcement ────────────────────────────────
    // Sensitive data (phone numbers, TOTP secrets) is encrypted at rest using
    // AES-256-GCM. A missing or invalid key in production means every encryption
    // call will throw at runtime — fail fast at startup instead.
    const encryptionKey = result.data.ENCRYPTION_KEY ?? "";
    if (!encryptionKey) {
      throw new Error(
        "\n❌ PRODUCTION DEPLOYMENT BLOCKED: ENCRYPTION_KEY is not set!\n" +
          "   Phone numbers and TOTP secrets cannot be encrypted without it.\n" +
          "   Generate a key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
          "   Set ENCRYPTION_KEY in your Vercel environment settings.\n",
      );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
      throw new Error(
        "\n❌ PRODUCTION DEPLOYMENT BLOCKED: ENCRYPTION_KEY is invalid!\n" +
          "   It must be exactly 64 hex characters (32 bytes for AES-256-GCM).\n" +
          "   Current length: " +
          encryptionKey.length +
          " characters.\n" +
          "   Generate a valid key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n",
      );
    }
  }

  return result.data;
}

export const env = validateEnv();

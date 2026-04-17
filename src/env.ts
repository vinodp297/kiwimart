// src/env.ts
// ─── Environment variable validation ─────────────────────────────────────────
// Validates all required environment variables at startup. Fails fast with ALL
// errors listed at once rather than discovering them one by one at runtime.
//
// Usage:
//   • next.config.ts imports this file as a side-effect for build-time validation
//   • Individual modules import { env } and use env.VARNAME instead of
//     process.env.VARNAME! (eliminates unsafe non-null assertions)
//
// Validation is skipped in the test environment — tests inject mocks and
// partial env objects that deliberately omit production secrets.

import { z } from "zod";

// ── Schema ────────────────────────────────────────────────────────────────────

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // ── Database ────────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // ── Auth ────────────────────────────────────────────────────────────────────
  NEXTAUTH_SECRET: z
    .string()
    .min(
      32,
      "NEXTAUTH_SECRET must be at least 32 characters — generate with: openssl rand -base64 32",
    ),

  // ── Redis (Upstash) ─────────────────────────────────────────────────────────
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url("UPSTASH_REDIS_REST_URL must be a valid URL"),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, "UPSTASH_REDIS_REST_TOKEN is required"),

  // ── Stripe ──────────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("sk_", "STRIPE_SECRET_KEY must start with 'sk_'"),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .startsWith("whsec_", "STRIPE_WEBHOOK_SECRET must start with 'whsec_'"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required"),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),

  // ── Email (Resend) ──────────────────────────────────────────────────────────
  RESEND_API_KEY: z
    .string()
    .startsWith("re_", "RESEND_API_KEY must start with 're_'"),

  // ── Storage (Cloudflare R2) ─────────────────────────────────────────────────
  NEXT_PUBLIC_R2_PUBLIC_URL: z
    .string()
    .url("NEXT_PUBLIC_R2_PUBLIC_URL must be a valid URL"),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1, "CLOUDFLARE_ACCOUNT_ID is required"),
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_BUCKET_NAME: z.string().min(1, "R2_BUCKET_NAME is required"),

  // ── App URL ─────────────────────────────────────────────────────────────────
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url("NEXT_PUBLIC_APP_URL must be a valid URL"),

  // ── Encryption ──────────────────────────────────────────────────────────────
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "ENCRYPTION_KEY must be exactly 64 hex characters",
    ),

  // ── Pusher ──────────────────────────────────────────────────────────────────
  PUSHER_APP_ID: z.string().min(1, "PUSHER_APP_ID is required"),
  PUSHER_KEY: z.string().min(1, "PUSHER_KEY is required"),
  PUSHER_SECRET: z.string().min(1, "PUSHER_SECRET is required"),
  PUSHER_CLUSTER: z.string().min(1, "PUSHER_CLUSTER is required"),
  NEXT_PUBLIC_PUSHER_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_PUSHER_KEY is required"),
  NEXT_PUBLIC_PUSHER_CLUSTER: z
    .string()
    .min(1, "NEXT_PUBLIC_PUSHER_CLUSTER is required"),

  // ── Google OAuth ────────────────────────────────────────────────────────────
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),

  // ── Twilio (OTP and pickup confirmation SMS) ─────────────────────────────────
  // All three must be set — the app fails loudly at startup when any are absent.
  // Obtain credentials from console.twilio.com; test credentials start with AC.
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  // Must be the sending number in E.164 format, e.g. +64211234567.
  // Named TWILIO_FROM_NUMBER to match the Vercel env var set during initial provisioning.
  TWILIO_FROM_NUMBER: z
    .string()
    .regex(
      /^\+[1-9]\d{1,14}$/,
      "TWILIO_FROM_NUMBER must be in E.164 format (e.g. +64211234567)",
    ),

  // ── Sentry (optional — error reporting) ─────────────────────────────────────
  SENTRY_DSN: z.string().optional(),

  // ── Cloudflare Turnstile (optional — CAPTCHA) ───────────────────────────────
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  // ── Turnstile enforcement flag ──────────────────────────────────────────────
  // Explicit opt-in. Replaces the previous NODE_ENV !== "production" check
  // which silently disabled bot protection on staging environments running
  // with NODE_ENV=staging or NODE_ENV=preview.
  TURNSTILE_ENFORCED: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((val) => val === "true"),

  // ── Mobile API JWT ──────────────────────────────────────────────────────────
  // Used to sign mobile app JWTs (jose HS256). Must be a hex string of at
  // least 32 characters. Generate with: openssl rand -hex 32
  MOBILE_JWT_SECRET: z
    .string()
    .min(32, "MOBILE_JWT_SECRET must be at least 32 characters")
    .regex(
      /^[0-9a-fA-F]+$/,
      "MOBILE_JWT_SECRET must be a hex string (openssl rand -hex 32)",
    ),

  // ── Mobile API CORS ─────────────────────────────────────────────────────────
  // Comma-separated list of allowed origins for the /api/v1 mobile endpoints.
  // Example: "https://app.buyzi.co.nz,https://staging.buyzi.co.nz"
  ALLOWED_ORIGINS: z
    .string()
    .min(1, "ALLOWED_ORIGINS must contain at least one origin")
    .optional(),

  // ── Dispute evidence upload limit (optional override) ───────────────────────
  DISPUTE_EVIDENCE_MAX_FILES: z.coerce
    .number()
    .int()
    .positive()
    .default(4)
    .optional(),

  // ── Redis (BullMQ — TCP native) ─────────────────────────────────────────────
  // Separate from UPSTASH_REDIS_REST_URL — BullMQ requires a native TCP
  // connection, not the Upstash REST API. In dev, set to a placeholder value
  // (e.g. "redis://PLACEHOLDER") and the queue client will fall back to
  // localhost:6379.
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // ── Cron job authentication ──────────────────────────────────────────────────
  // Bearer secret verified by verifyCronSecret(). Fail-closed — returns 503
  // if unset so cron endpoints are unreachable rather than open.
  CRON_SECRET: z.string().min(1, "CRON_SECRET is required"),

  // ── Worker process ───────────────────────────────────────────────────────────
  // PORT is used by the Render.com worker health server (default: 3001).
  PORT: z.coerce.number().int().positive().default(3001),
  // Bearer secret for /api/workers/health — falls back to admin session auth.
  WORKER_SECRET: z.string().optional(),

  // ── Admin notifications ─────────────────────────────────────────────────────
  // Email address for admin alerts (e.g. ID verification submissions).
  // When unset, admin notification emails are silently skipped.
  ADMIN_EMAIL: z.string().optional(),

  // ── Analytics (PostHog) ─────────────────────────────────────────────────────
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z
    .string()
    .url()
    .default("https://us.i.posthog.com"),

  // ── Log shipping (BetterStack / Logtail) ─────────────────────────────────────
  // When absent, log shipping is silently skipped — logger is fully functional.
  LOGTAIL_SOURCE_TOKEN: z.string().optional(),

  // ── CDN (secondary image delivery fallback) ──────────────────────────────────
  // Secondary fallback after NEXT_PUBLIC_R2_PUBLIC_URL. Optional.
  NEXT_PUBLIC_CDN_URL: z.string().optional(),

  // ── App branding ────────────────────────────────────────────────────────────
  NEXT_PUBLIC_APP_NAME: z.string().default("Buyzi"),
  NEXT_PUBLIC_SUPPORT_EMAIL: z.string().default("support@buyzi.co.nz"),

  // ── Cloudflare Turnstile (alternative key names) ─────────────────────────────
  // Both the CLOUDFLARE_TURNSTILE_* and TURNSTILE_* names are accepted for
  // backwards compatibility — callers try the Cloudflare-prefixed name first,
  // then fall back to the shorter TURNSTILE_* name that is already in the schema.
  CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().optional(),
  CLOUDFLARE_TURNSTILE_SITE_KEY: z.string().optional(),

  // ── Transactional email defaults ─────────────────────────────────────────────
  EMAIL_FROM: z.string().default("Buyzi <onboarding@resend.dev>"),
  NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY: z.string().default("$3,000"),
  COMPANY_LEGAL_NAME: z.string().default("Buyzi Limited"),
  COMPANY_ADDRESS: z.string().default("Auckland, New Zealand"),
  LISTING_POLICY_PATH: z.string().default("/policies/listing-guidelines"),

  // ── Business config (used in email templates) ────────────────────────────────
  // Coerced from string to number at startup — process.env values are always
  // strings. Override per-environment without a code change.
  OFFER_EXPIRY_HOURS: z.coerce.number().int().positive().default(72),
  OFFER_PURCHASE_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  REFUND_PROCESSING_DAYS_MIN: z.coerce.number().int().positive().default(5),
  REFUND_PROCESSING_DAYS_MAX: z.coerce.number().int().positive().default(10),
  PAYOUT_PROCESSING_DAYS_MIN: z.coerce.number().int().positive().default(2),
  PAYOUT_PROCESSING_DAYS_MAX: z.coerce.number().int().positive().default(3),
  RETURN_SHIPPING_WINDOW_DAYS: z.coerce.number().int().positive().default(7),

  // ── Admin health check SLO thresholds ────────────────────────────────────────
  HEALTH_PENDING_PAYOUTS_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
  HEALTH_FAILED_JOBS_THRESHOLD: z.coerce.number().int().positive().default(20),
  HEALTH_OLDEST_PAYOUT_HOURS: z.coerce.number().int().positive().default(48),
});

export type Env = z.infer<typeof envSchema>;

// ── Validation ────────────────────────────────────────────────────────────────

function validateEnv(): Env {
  // Skip validation in test environment — tests inject mocks and partial env
  // objects that deliberately omit production secrets.
  if (process.env.NODE_ENV === "test") {
    return process.env as unknown as Env;
  }

  // Skip during `next build` — production secrets are injected at deploy time,
  // not at build time. Server modules are evaluated during the build to collect
  // page data, so env.ts would throw on any CI machine that builds the app
  // without all runtime secrets. Validation still runs at server startup.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return process.env as unknown as Env;
  }

  // Client-side bundles cannot access server-only env vars — skip deep
  // validation there. Validation runs at server startup covering all variables.
  if (typeof window !== "undefined") {
    return process.env as unknown as Env;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `❌ Environment validation failed — fix the following before starting:\n${messages}`,
    );
  }

  return result.data;
}

export const env = validateEnv();

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

  // ── Twilio (optional — SMS notifications) ───────────────────────────────────
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

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

  // ── Dispute evidence upload limit (optional override) ───────────────────────
  DISPUTE_EVIDENCE_MAX_FILES: z.coerce
    .number()
    .int()
    .positive()
    .default(4)
    .optional(),
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

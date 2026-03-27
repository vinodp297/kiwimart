// src/infrastructure/config/env.ts
// ─── Environment Variable Validation ─────────────────────────────────────────
// Validates ALL environment variables at startup using Zod.
// App will not start if any required var is missing or invalid.
//
// IMPORTANT: This file runs at import time.
// Do NOT import it in any file that runs during the Next.js build
// unless all env vars are present in the build environment.

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_DIRECT_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters. Generate with: openssl rand -base64 32'),
  NEXTAUTH_URL: z.string().url(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
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
  CRON_SECRET: z.string().min(16),
  WORKER_SECRET: z.string().min(16),
  ADMIN_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors
    const missing = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(', ')}`)
      .join('\n')
    throw new Error(
      `\n❌ Invalid environment variables:\n${missing}\n` +
      `\nCheck your .env.local file and Vercel environment settings.`
    )
  }

  // ── Turnstile test key warning ───────────────────────────────────────────
  // Cloudflare test keys (1x/2x prefix) auto-pass all challenges — zero bot
  // protection. Warn loudly in production.
  const turnstileSiteKey = result.data.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
  if (
    result.data.NODE_ENV === 'production' &&
    (!turnstileSiteKey ||
     turnstileSiteKey.startsWith('1x') ||
     turnstileSiteKey.startsWith('2x'))
  ) {
    // Use console.error directly — logger may not be initialised yet
    console.error(
      '\n🚨 SECURITY WARNING: Turnstile is using test keys in production!\n' +
      '   Bot protection is DISABLED. Login/register forms are unprotected.\n' +
      '   Get real keys at: https://dash.cloudflare.com/turnstile\n' +
      '   Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and CLOUDFLARE_TURNSTILE_SECRET_KEY\n'
    )
  }

  return result.data
}

export const env = validateEnv()

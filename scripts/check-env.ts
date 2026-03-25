#!/usr/bin/env tsx
// scripts/check-env.ts
// ─── Environment Variable Validator ──────────────────────────────────────────
// Run before deploying to ensure all required env vars are present and not
// set to placeholder values.
//
// Auto-loads .env.local when running locally (in CI, vars come from secrets).
//
// Usage:
//   npm run check-env
//   # or directly:
//   tsx scripts/check-env.ts

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Load .env.local if present (local development — not needed in CI)
const envLocalPath = resolve(process.cwd(), '.env.local')
if (existsSync(envLocalPath)) {
  const lines = readFileSync(envLocalPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // Only set if not already set by the environment
    if (key && !(key in process.env)) {
      process.env[key] = value
    }
  }
}

const REQUIRED_VARS = [
  'DATABASE_URL',
  'DATABASE_DIRECT_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PUSHER_APP_ID',
  'PUSHER_KEY',
  'PUSHER_SECRET',
  'PUSHER_CLUSTER',
  'NEXT_PUBLIC_PUSHER_KEY',
  'NEXT_PUBLIC_PUSHER_CLUSTER',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'NEXT_PUBLIC_R2_PUBLIC_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'REDIS_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'CRON_SECRET',
  'WORKER_SECRET',
] as const

const PLACEHOLDER_PATTERNS = [
  'placeholder',
  'PLACEHOLDER',
  'REPLACE',
  'your-',
  'xxx',
  're_placeholder',
  'sk_test_x',
  'pk_test_x',
  'whsec_test',
]

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) =>
    value.toLowerCase().includes(p.toLowerCase())
  )
}

let missing = 0
let placeholders = 0

console.log('\n🔍 Checking environment variables...\n')

for (const varName of REQUIRED_VARS) {
  const value = process.env[varName]

  if (!value) {
    console.error(`❌  MISSING     : ${varName}`)
    missing++
  } else if (isPlaceholder(value)) {
    console.warn(`⚠️   PLACEHOLDER : ${varName}`)
    placeholders++
  } else {
    // Mask sensitive values — show type hint only
    const hint = varName.includes('SECRET') || varName.includes('TOKEN') || varName.includes('KEY')
      ? `${value.slice(0, 6)}...`
      : value.length > 40 ? `${value.slice(0, 40)}...` : value
    console.log(`✅  SET         : ${varName} (${hint})`)
  }
}

console.log('')

if (missing > 0) {
  console.error(`❌  ${missing} variable(s) missing. Set them before deploying.\n`)
  process.exit(1)
} else if (placeholders > 0) {
  console.warn(`⚠️   All variables set. ${placeholders} have placeholder values.`)
  console.warn('    Replace placeholder values before deploying to production.\n')
  process.exit(0)
} else {
  console.log('✅  All required variables are set and appear non-placeholder.\n')
  process.exit(0)
}

// src/infrastructure/storage/r2.ts
// ─── Cloudflare R2 Singleton Client ──────────────────────────────────────────
// Single S3Client instance configured for Cloudflare R2.
// Import { r2, R2_BUCKET, R2_PUBLIC_URL } from here instead of creating
// a new S3Client locally.

import { S3Client } from '@aws-sdk/client-s3'

if (
  !process.env.CLOUDFLARE_ACCOUNT_ID ||
  !process.env.R2_ACCESS_KEY_ID ||
  !process.env.R2_SECRET_ACCESS_KEY
) {
  throw new Error(
    'Cloudflare R2 credentials are not set. ' +
    'Ensure CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are configured.'
  )
}

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

export const R2_BUCKET = process.env.R2_BUCKET_NAME ?? 'kiwimart-listings'
export const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

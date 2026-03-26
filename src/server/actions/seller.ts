'use server'
// src/server/actions/seller.ts
// ─── Seller Onboarding Actions ────────────────────────────────────────────────

import { headers } from 'next/headers'
import { z } from 'zod'
import db from '@/lib/db'
import { requireUser } from '@/server/lib/requireUser'
import { requireAdmin } from '@/server/lib/requireAdmin'
import { audit } from '@/server/lib/audit'
import { rateLimit, getClientIp } from '@/server/lib/rateLimit'
import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client'
import type { ActionResult } from '@/types'

// ── Schemas ───────────────────────────────────────────────────────────────────

const ApproveIdSchema = z.object({
  userId: z.string().cuid('Invalid user ID'),
})

// ── Accept Seller Terms ───────────────────────────────────────────────────────

/**
 * Record that the current user has accepted the seller terms & conditions.
 * Idempotent — safe to call multiple times.
 */
export async function acceptSellerTerms(): Promise<ActionResult<void>> {
  // 1. Auth
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unauthorised.' }
  }

  // 2. Authorise — must have seller access
  if (!user.sellerEnabled) {
    return { success: false, error: 'Seller access is not enabled on your account.' }
  }

  // 3. Validate — nothing to validate beyond auth

  // 4. Rate limit — 5 attempts per 15 min (reuse auth limiter)
  const ip = getClientIp(await headers())
  const limit = await rateLimit('auth', `seller-terms:${user.id}`)
  if (!limit.success) {
    return { success: false, error: 'Too many requests. Please try again in a few minutes.' }
  }

  // 5. Execute
  await db.user.update({
    where: { id: user.id },
    data: { sellerTermsAcceptedAt: new Date() },
  })

  // 6. Audit
  audit({
    userId: user.id,
    action: 'SELLER_TERMS_ACCEPTED',
    entityType: 'User',
    entityId: user.id,
    ip,
  })

  // 7. Return
  return { success: true, data: undefined }
}

// ── Submit ID Verification Request ───────────────────────────────────────────

/**
 * Mark the current user as having submitted their ID for verification.
 * Sends an admin notification email.
 */
export async function submitIdVerification(): Promise<ActionResult<void>> {
  // 1. Auth
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unauthorised.' }
  }

  // 2. Authorise
  if (!user.sellerEnabled) {
    return { success: false, error: 'Seller access is not enabled on your account.' }
  }

  // 3. Rate limit — prevent repeated submissions
  const ip = getClientIp(await headers())
  const limit = await rateLimit('auth', `id-verify:${user.id}`)
  if (!limit.success) {
    return { success: false, error: 'Too many requests. Please try again in a few minutes.' }
  }

  // 4. Check not already submitted or verified
  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { idVerified: true, idSubmittedAt: true },
  })

  if (!dbUser) return { success: false, error: 'User not found.' }
  if (dbUser.idVerified) return { success: false, error: 'Your ID is already verified.' }
  if (dbUser.idSubmittedAt) {
    return { success: false, error: 'Your ID verification is already pending review.' }
  }

  // 5. Execute
  const now = new Date()
  await db.user.update({
    where: { id: user.id },
    data: { idSubmittedAt: now },
  })

  // 6. Audit
  audit({
    userId: user.id,
    action: 'ID_VERIFICATION_SUBMITTED',
    entityType: 'User',
    entityId: user.id,
    ip,
  })

  // 7. Notify admin by email (non-blocking)
  const adminEmail = process.env.ADMIN_EMAIL
  const emailClient = getEmailClient()
  if (emailClient && adminEmail) {
    emailClient.emails
      .send({
        from: EMAIL_FROM,
        to: adminEmail,
        subject: '[KiwiMart] New ID Verification Request',
        html: `
          <p>A seller has submitted their ID for verification.</p>
          <ul>
            <li><strong>User ID:</strong> ${user.id}</li>
            <li><strong>Email:</strong> ${user.email}</li>
            <li><strong>Submitted at:</strong> ${now.toISOString()}</li>
          </ul>
          <p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/admin">
              Review in Admin Dashboard →
            </a>
          </p>
        `,
      })
      .catch(() => {}) // non-fatal
  }

  return { success: true, data: undefined }
}

// ── Approve ID Verification (Admin) ──────────────────────────────────────────

/**
 * Admin action: mark a user's ID as verified and send them a confirmation email.
 */
export async function approveIdVerification(userId: string): Promise<ActionResult<void>> {
  // 1. Auth — admin only
  const guard = await requireAdmin()
  if ('error' in guard) return { success: false, error: guard.error }

  // 2. Validate input
  const parsed = ApproveIdSchema.safeParse({ userId })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  // 3. Check user exists and has a pending submission
  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, email: true, idVerified: true, idSubmittedAt: true },
  })

  if (!target) return { success: false, error: 'User not found.' }
  if (target.idVerified) return { success: false, error: 'User is already ID-verified.' }
  if (!target.idSubmittedAt) {
    return { success: false, error: 'User has not submitted an ID verification request.' }
  }

  // 4. Execute
  const now = new Date()
  await db.user.update({
    where: { id: target.id },
    data: { idVerified: true, idVerifiedAt: now },
  })

  // 5. Audit
  audit({
    userId: guard.userId,
    action: 'ID_VERIFICATION_APPROVED',
    entityType: 'User',
    entityId: target.id,
    metadata: { approvedBy: guard.userId },
  })

  // 6. Notify the seller (non-blocking)
  const emailClient = getEmailClient()
  if (emailClient) {
    emailClient.emails
      .send({
        from: EMAIL_FROM,
        to: target.email,
        subject: 'Your KiwiMart ID verification has been approved!',
        html: `
          <p>Great news! Your identity verification has been approved.</p>
          <p>
            You now have <strong>ID-Verified Seller</strong> status on KiwiMart,
            which unlocks unlimited listings and next-day payouts.
          </p>
          <p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/seller/onboarding">
              View your Seller Hub →
            </a>
          </p>
        `,
      })
      .catch(() => {}) // non-fatal
  }

  // 7. Return
  return { success: true, data: undefined }
}

// src/modules/users/auth.service.ts
// ─── Auth Service ────────────────────────────────────────────────────────────
// Registration and password reset flows. Framework-free.

import db from '@/lib/db'
import { hashPassword } from '@/server/lib/password'
import { audit } from '@/server/lib/audit'
import { logger } from '@/shared/logger'
import { AppError } from '@/shared/errors'
import crypto from 'crypto'
import type { RegisterInput, ResetPasswordInput } from './user.types'

function generateUsername(firstName: string, lastName: string): string {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20)
  return base || 'user'
}

async function verifyTurnstile(token: string): Promise<boolean> {
  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY!,
          response: token,
        }),
      }
    )
    const data = (await res.json()) as { success: boolean }
    return data.success
  } catch {
    return false
  }
}

export class AuthService {
  async register(
    input: RegisterInput,
    ip: string,
    userAgent?: string
  ): Promise<{ userId: string }> {
    // Verify Turnstile in production
    if (process.env.NODE_ENV === 'production' && input.turnstileToken) {
      const turnstileOk = await verifyTurnstile(input.turnstileToken)
      if (!turnstileOk) {
        throw AppError.validation('Bot verification failed. Please try again.')
      }
    }

    // Check email uniqueness
    const existingEmail = await db.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })
    if (existingEmail) {
      throw AppError.validation('An account with this email already exists.')
    }

    // Generate username
    const username = generateUsername(input.firstName, input.lastName)
    const existingUsername = await db.user.findUnique({
      where: { username },
      select: { id: true },
    })
    const finalUsername = existingUsername
      ? `${username}${Math.floor(Math.random() * 9000) + 1000}`
      : username

    // Hash password
    const passwordHash = await hashPassword(input.password)

    // Create user
    const user = await db.user.create({
      data: {
        email: input.email,
        username: finalUsername,
        displayName: `${input.firstName} ${input.lastName}`,
        passwordHash,
        agreeMarketing: input.agreeMarketing,
        agreedTermsAt: new Date(),
      },
      select: { id: true, email: true, displayName: true },
    })

    // Send welcome email directly — BullMQ worker does not run on Vercel serverless
    try {
      const { sendWelcomeEmail } = await import('@/server/email')
      await sendWelcomeEmail({ to: user.email, displayName: user.displayName })
    } catch (err) {
      // Non-blocking — user is already registered; log for ops visibility
      logger.warn('user.register.welcome_email.failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    audit({
      userId: user.id,
      action: 'USER_REGISTER',
      metadata: { email: user.email, username: finalUsername },
      ip,
      userAgent,
    })

    logger.info('user.registered', { userId: user.id, username: finalUsername })

    return { userId: user.id }
  }

  async requestPasswordReset(email: string, ip: string, userAgent: string | null): Promise<void> {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true },
    })

    // Always succeed to prevent user enumeration
    if (!user) return

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestIp: ip,
        userAgent,
      },
    })

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}`
    // Send password-reset email directly — BullMQ worker does not run on Vercel serverless
    try {
      const { sendPasswordResetEmail } = await import('@/server/email')
      await sendPasswordResetEmail({
        to: user.email, displayName: user.displayName, resetUrl, expiresInMinutes: 60,
      })
    } catch (err) {
      // Log but do not rethrow — caller always returns success to prevent user enumeration
      logger.warn('user.password_reset.email.failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    audit({
      userId: user.id,
      action: 'USER_PASSWORD_CHANGED',
      metadata: { step: 'reset_requested' },
      ip,
    })
  }

  async resetPassword(input: ResetPasswordInput, ip: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex')

    const resetRecord = await db.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, displayName: true } } },
    })

    const GENERIC_ERROR = 'Invalid or expired reset link. Please request a new one.'
    if (!resetRecord) throw AppError.validation(GENERIC_ERROR)
    if (resetRecord.usedAt) throw AppError.validation(GENERIC_ERROR)
    if (resetRecord.expiresAt < new Date()) throw AppError.validation(GENERIC_ERROR)

    const newHash = await hashPassword(input.password)
    await db.$transaction([
      db.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash: newHash },
      }),
      db.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      db.session.deleteMany({ where: { userId: resetRecord.userId } }),
    ])

    audit({
      userId: resetRecord.userId,
      action: 'USER_PASSWORD_CHANGED',
      metadata: { step: 'reset_completed' },
      ip,
    })

    logger.info('user.password.reset', { userId: resetRecord.userId })
  }
}

export const authService = new AuthService()
